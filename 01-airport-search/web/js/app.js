/* =====================================================================
 *  app.js — UI. Runs offline against the built-in sample by default;
 *  if a FastAPI backend answers /api/health it switches to live TiDB.
 * ===================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, txt) => { const n = document.createElement(tag);
    if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  let lang = pickLang();
  const t = () => I18N[lang];

  const STRATS = [
    { key: "like",     label: "SQL LIKE",   css: "var(--like)", code: "WHERE name LIKE '%q%'" },
    { key: "fulltext", label: "Full-Text",  css: "var(--fts)",  code: "FTS_MATCH_WORD(q, doc)" },
    { key: "vector",   label: "Vector",     css: "var(--vec)",  code: "VEC_COSINE_DISTANCE()" },
    { key: "hybrid",   label: "Hybrid RRF", css: "var(--hyb)",  code: "" },
  ];

  // --------------------------------------------------------------- SQL ---
  // Character-for-character the queries in sql/02_queries.sql, with the
  // user's string pasted in. `@qv` is the only thing the app has to compute
  // outside the database.
  const SQL = {
    like: (q) => `-- (1) LIKE · substring scan, no index can serve it
SELECT id, name, city, country, iata, icao, alt_ft,
       CASE WHEN iata = UPPER('${q}')            THEN 100
            WHEN name LIKE '${q}%'               THEN 80
            WHEN city LIKE '${q}%'               THEN 70
            WHEN name LIKE '%${q}%'              THEN 50
            ELSE 30 END AS score          -- hand-rolled: LIKE has no ranking
FROM airports
WHERE name    LIKE '%${q}%'
   OR city    LIKE '%${q}%'
   OR country LIKE '%${q}%'
   OR iata    = UPPER('${q}')
   OR icao    = UPPER('${q}')
ORDER BY score DESC,
         FIELD(size_class,'hub','large','regional'),   -- ties: busiest first
         name
LIMIT 10;`,

    fulltext: (q) => `-- (2) FULL-TEXT · tokenised, BM25-ranked
-- index:  FULLTEXT INDEX ft_doc (doc) WITH PARSER MULTILINGUAL
SELECT id, name, city, country, iata, icao, alt_ft,
       FTS_MATCH_WORD('${q}', doc) AS score   -- same call as predicate + score
FROM airports
WHERE FTS_MATCH_WORD('${q}', doc)
ORDER BY score DESC
LIMIT 10;`,

    vector: (q) => `-- (3) VECTOR · semantic similarity over embeddings
-- index:  VECTOR INDEX idx_doc_vec ((VEC_COSINE_DISTANCE(doc_vec)))
--         HNSW, served from the TiFlash columnar replica.

-- The app embeds the query string first — the only step that happens
-- outside the database. 1536 floats for text-embedding-3-small.
SET @qv = '[0.0131,-0.4422, ... 1532 more ... ,0.0917]';   -- embed('${q}')

SELECT id, name, city, country, iata, icao, alt_ft,
       1 - VEC_COSINE_DISTANCE(doc_vec, @qv) AS similarity
FROM airports
ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)     -- ASC: nearest neighbour first
LIMIT 3;

-- Note what is NOT here: a WHERE clause. A vector search always returns
-- exactly LIMIT rows, however far away the nearest neighbours are. There
-- is no "no match" — which is why it needs a keyword partner.`,

    hybrid: (q) => `-- (4) HYBRID · Reciprocal Rank Fusion, one statement, one snapshot
--
--     rrf(d) = SUM over retrievers r of   weight_r / (k + rank_r(d))
--
-- RRF fuses RANKS, so a BM25 score, a cosine similarity and a hand-made
-- CASE expression never have to be normalised onto one scale.
SET @qv = '[0.0131,-0.4422, ... 1532 more ... ,0.0917]';   -- embed('${q}')
SET @k  = 60;      -- standard RRF constant
SET @n  = 20;      -- candidates each retriever contributes

WITH
lex AS (                                    -- (1) LIKE candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY
               CASE WHEN iata = UPPER('${q}') THEN 0
                    WHEN name LIKE '${q}%'    THEN 1
                    ELSE 2 END,
               FIELD(size_class,'hub','large','regional'), name) AS rnk
    FROM airports
    WHERE name LIKE '%${q}%' OR city LIKE '%${q}%' OR iata = UPPER('${q}')
    LIMIT 20
),
fts AS (                                    -- (2) full-text candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY FTS_MATCH_WORD('${q}', doc) DESC) AS rnk
    FROM airports
    WHERE FTS_MATCH_WORD('${q}', doc)
      AND FTS_MATCH_WORD('${q}', doc) >= 0.30   -- score gate, see note below
    LIMIT 20
),
vec AS (                                    -- (3) vector candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)) AS rnk
    FROM (
        SELECT id, doc_vec
        FROM airports
        WHERE 1 - VEC_COSINE_DISTANCE(doc_vec, @qv) >= 0.58   -- score gate
        ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)
        LIMIT 20
    ) t
),
fused AS (
    SELECT id, SUM(w / (60 + rnk)) AS rrf
    FROM (
        SELECT id, rnk, 1.0 AS w FROM lex
        UNION ALL
        SELECT id, rnk, 1.0 AS w FROM fts
        UNION ALL
        SELECT id, rnk, 1.4 AS w FROM vec      -- weights are per-dataset
    ) all_lists
    GROUP BY id
)
SELECT a.id, a.name, a.city, a.country, a.iata, a.alt_ft,
       f.rrf AS score,
       (SELECT rnk FROM lex WHERE lex.id = a.id) AS like_rank,   -- provenance:
       (SELECT rnk FROM fts WHERE fts.id = a.id) AS fts_rank,    -- who voted
       (SELECT rnk FROM vec WHERE vec.id = a.id) AS vec_rank     -- for this row
FROM fused f
JOIN airports a ON a.id = f.id
ORDER BY f.rrf DESC
LIMIT 3;

-- The two score gates matter. Plain RRF only looks at rank, so a retriever
-- that found nothing useful still votes with its rank-1 garbage. Gating on
-- score first is what stops "airport near Silicon Valley" from being decided
-- by ten BM25 rows whose only shared word is "airport".`,
  };

  let live = false, live_n = 0, globe = null, lastResult = null, sqlTab = "hybrid";

  // -------------------------------------------------------------- boot ---
  Engine.build(AIRPORTS);
  buildColumns();
  buildLangs();
  applyChrome();

  globe = Globe.init($("#globe"), AIRPORTS, ROUTES, showTip);
  $("#globe-mode").textContent = Globe.mode === "3d" ? "WEBGL / 3D" : "CANVAS / 2D";

  $("#run").addEventListener("click", () => run($("#q").value));
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run($("#q").value); });
  $$(".sqltab").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault(); sqlTab = b.dataset.k; paintSql();
  }));

  probeBackend().then(() => run(t().presets[0].q));

  async function probeBackend() {
    try {
      const r = await fetch("/api/health", { signal: AbortSignal.timeout(1200) });
      const j = await r.json();
      if (j.ok) { live = true; live_n = j.airports; }
    } catch { /* offline sample — the default */ }
    paintMode();
  }

  // ---------------------------------------------------------- language ---
  function buildLangs() {
    const box = $("#langs");
    Object.keys(I18N).forEach((code) => {
      const b = el("button", "lang", I18N[code].name);
      b.dataset.lang = code;
      b.addEventListener("click", () => setLang(code));
      box.appendChild(b);
    });
  }

  function setLang(code) {
    if (code === lang) return;
    // if the box still holds a preset, swap to the same preset in the new
    // language rather than leaving a Portuguese query under a Chinese UI
    const cur = $("#q").value.trim();
    const hit = t().presets.find((p) => p.q === cur);
    lang = code;
    try { localStorage.setItem("airport-demo-lang", code); } catch { /* private mode */ }
    applyChrome();
    run(hit ? t().presets.find((p) => p.id === hit.id).q : cur);
  }

  /** Everything that is not a search result. */
  function applyChrome() {
    const T = t();
    document.documentElement.lang = lang;
    document.title = `${T.title} · TiDB AI Demos`;
    $("#app-title").textContent = T.title;
    $("#app-sub").textContent = T.subtitle;
    $("#globe-title-text").textContent = T.globeTitle;
    $("#lg-hub").textContent = T.hub;
    $("#lg-large").textContent = T.large;
    $("#lg-regional").textContent = T.regional;
    $("#globe-hint").textContent = T.globeHint;
    $("#q").placeholder = T.placeholder;
    $("#run").textContent = T.search;
    $("#verdict-key").textContent = T.compare;
    $("#sql-label").textContent = T.sqlSummary;
    $$(".lang").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
    STRATS.forEach((s) => {
      $(`#blurb-${s.key}`).innerHTML = T.cols[s.key].blurb
        + (s.code ? ` <code>${esc(s.code)}</code>` : "");
    });
    buildPresets();
    paintMode();
  }

  function paintMode() {
    const b = $("#mode");
    b.className = live ? "badge live" : "badge";
    b.textContent = live ? t().live(live_n.toLocaleString()) : t().offline;
  }

  // ------------------------------------------------------------ layout ---
  function buildColumns() {
    const wrap = $(".cols");
    STRATS.forEach((s, i) => {
      const col = el("section", "col" + (s.key === "hybrid" ? " hero" : ""));
      col.style.setProperty("--c", s.css);
      col.innerHTML = `<div class="col-head">
          <h3>${String(i + 1).padStart(2, "0")} · ${s.label}<span class="n" id="n-${s.key}">—</span></h3>
          <p id="blurb-${s.key}"></p></div>
        <div class="list" id="list-${s.key}"></div>`;
      wrap.appendChild(col);
    });
  }

  function buildPresets() {
    const box = $(".presets");
    box.innerHTML = "";
    t().presets.forEach((p) => {
      const c = el("button", "chip");
      c.innerHTML = `${esc(p.label)}<small>${esc(p.q.length > 26 ? p.q.slice(0, 24) + "…" : p.q)}</small>`;
      c.title = p.hint;
      c.dataset.q = p.q;
      c.addEventListener("click", () => run(p.q));
      box.appendChild(c);
    });
  }

  // ------------------------------------------------------------ search ---
  async function run(q) {
    q = (q || "").trim();
    if (!q) return;
    $("#q").value = q;
    $$(".chip").forEach((c) => c.classList.toggle("on", c.dataset.q === q));

    let res;
    if (live) {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        res = normalizeServer(await r.json());
      } catch { live = false; paintMode(); }
    }
    if (!res) res = Engine.searchAll(AIRPORTS, q);
    lastResult = res;

    STRATS.forEach((s) => paintColumn(s, res.strategies[s.key], res));
    paintVerdict(q, res);
    paintSql();

    const hyb = res.strategies.hybrid.results;
    globe.setResults(hyb.map((r, i) => ({ a: r.a, key: "hybrid", top: i === 0 })));
    if (hyb[0]) globe.focus(hyb[0].a);
  }

  /** Map the FastAPI payload onto the shape the UI already renders. */
  function normalizeServer(j) {
    const out = { query: j.query, strategies: {} };
    const LABEL = { like_rank: "LIKE", fts_rank: "FTS", vec_rank: "VEC" };
    for (const [k, v] of Object.entries(j.strategies)) {
      const max = Math.max(...v.results.map((r) => r.score), 1e-9);
      out.strategies[k] = {
        tookMs: v.took_ms, error: v.error,
        results: v.results.map((r) => ({
          id: r.id, a: r, rank: r.rank, score: r.score, norm: r.score / max,
          why: Object.entries(LABEL)
            .filter(([col]) => r[col] != null)
            .map(([col, name]) => ({ k: "src", r: name, n: r[col] })),
        })),
      };
    }
    return out;
  }

  // ----------------------------------------------------------- columns ---
  function paintColumn(s, data, res) {
    const T = t(), list = $(`#list-${s.key}`);
    list.innerHTML = "";
    const rows = (data && data.results) || [];
    const kept = rows.filter((r) => !r.belowGate).length;

    $(`#n-${s.key}`).textContent = data && data.error ? "ERROR"
      : `${rows.length} ${T.hits}${data.tookMs != null ? ` · ${Math.round(data.tookMs)} ms` : ""}`;

    if (data && data.error) {
      const e = el("div", "empty"); e.innerHTML = `<span class="big">!</span>${esc(data.error)}`;
      list.appendChild(e); return;
    }
    if (!rows.length) {
      const e = el("div", "empty");
      e.innerHTML = `<span class="big">∅</span>${T.emptyTitle}<br>${
        s.key === "like" ? T.emptyLike : T.emptyOther}`;
      list.appendChild(e);
      list.appendChild(el("div", "gate-note", T.cols[s.key].note));
      return;
    }
    if (kept === 0 && s.key !== "like") {
      const n = el("div", "gate-note");
      n.innerHTML = T.gateAllBelow;
      list.appendChild(n);
    }

    // which airports did ONLY this retriever find?
    const others = new Set();
    STRATS.forEach((o) => {
      if (o.key === s.key || o.key === "hybrid") return;
      (res.strategies[o.key].results || []).forEach((r) => { if (!r.belowGate) others.add(r.id); });
    });

    rows.forEach((r) => {
      const a = r.a;
      const row = el("div", "row" + (r.belowGate ? " dim" : "")
        + (s.key !== "hybrid" && !r.belowGate && !others.has(r.id) ? " new" : ""));
      const alt = a.alt_ft ?? a.altFt;
      row.innerHTML = `<span class="rk">${r.rank}</span>
        <span class="nm"><b>${mark(a.name, res.query, s.key)}</b>
          <span class="meta">${esc(a.city)} · ${esc(a.country)}${
            alt ? " · " + alt.toLocaleString() + " ft" : ""}</span></span>
        <span class="iata">${esc(a.iata || "—")}</span>
        <span class="bar"><i style="width:${Math.round((r.norm ?? 0) * 100)}%"></i></span>
        <span class="why">${fmtScore(s.key, r)}${
          renderWhy(r.why) ? " · " + esc(renderWhy(r.why)) : ""}</span>`;
      row.addEventListener("mouseenter", () => {
        globe.setResults([{ a, key: s.key, top: true }]);
        globe.focus(a);
      });
      row.addEventListener("mouseleave", () => {
        const h = lastResult.strategies.hybrid.results;
        globe.setResults(h.map((x, i) => ({ a: x.a, key: "hybrid", top: i === 0 })));
      });
      list.appendChild(row);
    });
  }

  /** The engine reports WHY structurally; the language is chosen here. */
  function renderWhy(why) {
    if (!Array.isArray(why)) return "";
    const W = t().why;
    return why.map((w) => {
      switch (w.k) {
        case "bm25": return W.bm25(w.terms.join(", "));
        case "concept": return W.concept(w.p);
        case "fuzzy": return W.fuzzy(w.v.toFixed(2));
        case "src": return `${w.r}#${w.n}`;
        default: return W[w.k] || "";
      }
    }).filter(Boolean).join(" · ");
  }

  const fmtScore = (k, r) =>
    k === "vector" ? `sim ${r.score.toFixed(3)}`
    : k === "hybrid" ? `rrf ${r.score.toFixed(5)}`
    : k === "fulltext" ? `bm25 ${r.score.toFixed(2)}`
    : `score ${Math.round(r.score)}`;

  /** Highlight the literal substring, but only where LIKE would see it. */
  function mark(name, q, key) {
    if (key !== "like") return esc(name);
    const needle = q.trim();
    const i = name.toLowerCase().indexOf(needle.toLowerCase());
    if (i < 0 || !needle) return esc(name);
    return esc(name.slice(0, i)) + "<em>" + esc(name.slice(i, i + needle.length)) + "</em>"
      + esc(name.slice(i + needle.length));
  }

  // ----------------------------------------------------------- verdict ---
  function paintVerdict(q, res) {
    const T = t(), ids = {};
    STRATS.forEach((s) => {
      ids[s.key] = new Set((res.strategies[s.key].results || [])
        .filter((r) => !r.belowGate).map((r) => r.id));
    });
    const onlyVec = [...ids.vector].filter((i) => !ids.like.has(i) && !ids.fulltext.has(i));
    const onlyLex = [...new Set([...ids.like, ...ids.fulltext])].filter((i) => !ids.vector.has(i));
    const code = (id) => {
      const a = AIRPORTS.find((x) => x.id === id)
        || (res.strategies.hybrid.results.find((r) => r.id === id) || {}).a;
      return (a && a.iata) || "?";
    };

    const counts = STRATS.map((s) => {
      const all = (res.strategies[s.key].results || []).length;
      const good = ids[s.key].size;
      return `<b style="color:${s.css}">${s.label}</b> ${good}`
        + (all > good ? `<span style="opacity:.5">${T.lowConf(all - good)}</span>` : "");
    }).join(" &nbsp;·&nbsp; ");

    const bits = [];
    if (onlyVec.length) bits.push(`<span class="only">${esc(T.onlyVector(onlyVec.slice(0, 6).map(code).join(" ")))}</span>`);
    if (onlyLex.length) bits.push(esc(T.onlyLexical(onlyLex.slice(0, 6).map(code).join(" "))));
    if (!bits.length) bits.push(esc(T.allAgree));

    const preset = t().presets.find((p) => p.q === q);
    $("#verdict-body").innerHTML =
      `${counts}<br><span style="opacity:.85">${bits.join(" &nbsp;|&nbsp; ")}</span>`
      + (preset ? `<br><span style="color:var(--fg-faint)">💡 ${esc(preset.hint)}</span>` : "");
  }

  // --------------------------------------------------------------- sql ---
  function paintSql() {
    $$(".sqltab").forEach((b) => b.classList.toggle("on", b.dataset.k === sqlTab));
    const q = ((lastResult && lastResult.query) || "").replace(/'/g, "''");
    $("#sql").innerHTML = esc(SQL[sqlTab](q))
      .replace(/(--[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(SELECT|FROM|WHERE|ORDER BY|GROUP BY|LIMIT|JOIN|ON|USING|WITH|AS|CASE|WHEN|THEN|ELSE|END|UNION ALL|OVER|SET|OR|AND|DESC|UPPER|LIKE|FIELD)\b/g,
        '<span class="kw">$1</span>')
      .replace(/\b(FTS_MATCH_WORD|VEC_COSINE_DISTANCE|ROW_NUMBER|SUM)\b/g, '<span class="fn">$1</span>')
      .replace(/('(?:[^']|'')*')/g, '<span class="st">$1</span>');
  }

  // ------------------------------------------------------------- globe ---
  function showTip(a, x, y) {
    const tip = $("#globe-tip");
    if (!a) { tip.style.opacity = 0; return; }
    tip.innerHTML = `<b>${esc(a.iata)}</b> ${esc(a.name)}<br>`
      + `<span style="opacity:.65">${esc(a.city)} · ${esc(a.country)}</span>`;
    tip.style.left = x + "px"; tip.style.top = y + "px"; tip.style.opacity = 1;
  }
})();
