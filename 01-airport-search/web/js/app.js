/* =====================================================================
 *  app.js — UI. Runs offline against the built-in sample by default;
 *  if a FastAPI backend answers /api/health it switches to live TiDB.
 * ===================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, cls, txt) => { const n = document.createElement(t);
    if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

  const STRATS = [
    { key: "like", label: "SQL LIKE", css: "var(--like)",
      blurb: 'Substring scan. <code>WHERE name LIKE \'%q%\'</code>',
      note: "精确、可解释、零依赖 — 但不认识词序、拼写和同义词，而且无法用索引。" },
    { key: "fulltext", label: "Full-Text", css: "var(--fts)",
      blurb: 'Tokenised BM25. <code>FTS_MATCH_WORD(q, doc)</code>',
      note: "词序无关、有真正的相关性排序 — 但匹配的仍然是「词」，错字和同义词都是另一个词。" },
    { key: "vector", label: "Vector", css: "var(--vec)",
      blurb: 'Cosine on embeddings. <code>VEC_COSINE_DISTANCE()</code>',
      note: "理解语义、容错、跨语言 — 但永远返回 k 条，没有「没找到」这个概念。" },
    { key: "hybrid", label: "Hybrid RRF", css: "var(--hyb)",
      blurb: 'Rank fusion of all three, one SQL statement',
      note: "用别人的长处补自己的短处：关键词负责精确，向量负责理解，RRF 负责合并。" },
  ];

  const SQL = {
    like: `SELECT id, name, city, country, iata,
       CASE WHEN iata = UPPER('@Q') THEN 100
            WHEN name LIKE '@Q%'    THEN 80
            WHEN city LIKE '@Q%'    THEN 70
            ELSE 50 END AS score
FROM airports
WHERE name LIKE '%@Q%' OR city LIKE '%@Q%'
   OR country LIKE '%@Q%' OR iata = UPPER('@Q')
ORDER BY score DESC, FIELD(size_class,'hub','large','regional'), name
LIMIT 10;
-- no index can serve a leading wildcard: this is a full scan`,
    fulltext: `SELECT id, name, city, country, iata,
       FTS_MATCH_WORD('@Q', doc) AS score      -- BM25
FROM airports
WHERE FTS_MATCH_WORD('@Q', doc)
ORDER BY score DESC
LIMIT 10;
-- served by:  FULLTEXT INDEX ft_doc (doc) WITH PARSER MULTILINGUAL`,
    vector: `SET @qv = <embedding of '@Q'>;   -- 1536 floats

SELECT id, name, city, country, iata,
       1 - VEC_COSINE_DISTANCE(doc_vec, @qv) AS score
FROM airports
ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)
LIMIT 10;
-- served by:  VECTOR INDEX idx_doc_vec ((VEC_COSINE_DISTANCE(doc_vec)))`,
    hybrid: `WITH
lex AS (SELECT id, ROW_NUMBER() OVER (ORDER BY ...) rnk
        FROM airports WHERE name LIKE '%@Q%' OR iata = UPPER('@Q') LIMIT 20),
fts AS (SELECT id, ROW_NUMBER() OVER (ORDER BY FTS_MATCH_WORD('@Q',doc) DESC) rnk
        FROM airports WHERE FTS_MATCH_WORD('@Q', doc) LIMIT 20),
vec AS (SELECT id, ROW_NUMBER() OVER (ORDER BY VEC_COSINE_DISTANCE(doc_vec,@qv)) rnk
        FROM (SELECT id, doc_vec FROM airports
              ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv) LIMIT 20) t)
SELECT a.*, SUM(w / (60 + rnk)) AS rrf          -- Reciprocal Rank Fusion
FROM (SELECT id,rnk,1.0 w FROM lex
      UNION ALL SELECT id,rnk,1.0 FROM fts
      UNION ALL SELECT id,rnk,1.4 FROM vec) x
JOIN airports a USING (id)
GROUP BY a.id ORDER BY rrf DESC LIMIT 10;
-- three retrievers, one statement, one consistent snapshot`,
  };

  let live = false, globe = null, lastResult = null, sqlTab = "hybrid";

  // ---------- boot --------------------------------------------------------
  Engine.build(AIRPORTS);
  buildColumns();
  buildPresets();

  globe = Globe.init($("#globe"), AIRPORTS, ROUTES, showTip);
  $("#globe-mode").textContent = Globe.mode === "3d" ? "WEBGL / 3D" : "CANVAS / 2D";

  $("#run").addEventListener("click", () => run($("#q").value));
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run($("#q").value); });
  $$(".sqltab").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault(); sqlTab = b.dataset.k; paintSql();
  }));

  probeBackend().then(() => run(PRESETS[0].q));

  async function probeBackend() {
    try {
      const r = await fetch("/api/health", { signal: AbortSignal.timeout(1200) });
      const j = await r.json();
      if (j.ok) {
        live = true;
        $("#mode").className = "badge live";
        $("#mode").textContent = `LIVE TiDB · ${j.airports.toLocaleString()} airports`;
      }
    } catch { /* offline sample — the default */ }
  }

  // ---------- render scaffolding -----------------------------------------
  function $$(s, r = document) { return [...r.querySelectorAll(s)]; }

  function buildColumns() {
    const wrap = $(".cols");
    STRATS.forEach((s, i) => {
      const col = el("section", "col" + (s.key === "hybrid" ? " hero" : ""));
      col.style.setProperty("--c", s.css);
      col.innerHTML = `<div class="col-head">
          <h3>${String(i + 1).padStart(2, "0")} · ${s.label}<span class="n" id="n-${s.key}">—</span></h3>
          <p>${s.blurb}</p></div>
        <div class="list" id="list-${s.key}"></div>`;
      wrap.appendChild(col);
    });
  }

  function buildPresets() {
    const box = $(".presets");
    PRESETS.forEach((p) => {
      const c = el("button", "chip");
      c.innerHTML = `${p.label}<small>${p.q.length > 26 ? p.q.slice(0, 24) + "…" : p.q}</small>`;
      c.title = p.hint;
      c.addEventListener("click", () => { $("#q").value = p.q; run(p.q); });
      c.dataset.q = p.q;
      box.appendChild(c);
    });
  }

  // ---------- search ------------------------------------------------------
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
      } catch (e) { live = false; $("#mode").className = "badge"; $("#mode").textContent = "OFFLINE SAMPLE"; }
    }
    if (!res) res = Engine.searchAll(AIRPORTS, q, 10);
    lastResult = res;

    STRATS.forEach((s) => paintColumn(s, res.strategies[s.key], res));
    paintVerdict(q, res);
    paintSql();

    const hyb = res.strategies.hybrid.results;
    globe.setResults(hyb.map((r, i) => ({ a: r.a, key: "hybrid", top: i === 0 })));
    if (hyb[0]) globe.focus(hyb[0].a);
  }

  /** map the FastAPI payload onto the shape the UI already renders */
  function normalizeServer(j) {
    const out = { query: j.query, strategies: {} };
    for (const [k, v] of Object.entries(j.strategies)) {
      const max = Math.max(...v.results.map((r) => r.score), 1e-9);
      out.strategies[k] = {
        tookMs: v.took_ms, error: v.error,
        results: v.results.map((r) => ({
          id: r.id, a: r, rank: r.rank, score: r.score, norm: r.score / max,
          why: r.sources ? r.sources.map((s) => s.toUpperCase()).join(" + ") : "",
        })),
      };
    }
    return out;
  }

  // ---------- columns -----------------------------------------------------
  function paintColumn(s, data, res) {
    const list = $(`#list-${s.key}`);
    list.innerHTML = "";
    const rows = (data && data.results) || [];
    const kept = rows.filter((r) => !r.belowGate).length;

    $(`#n-${s.key}`).textContent = data && data.error ? "ERROR"
      : rows.length === 0 ? "0 hits"
      : `${rows.length} hits${data.tookMs != null ? ` · ${Math.round(data.tookMs)} ms` : ""}`;

    if (data && data.error) {
      const e = el("div", "empty"); e.innerHTML = `<span class="big">!</span>${data.error}`;
      list.appendChild(e); return;
    }
    if (!rows.length) {
      const e = el("div", "empty");
      e.innerHTML = `<span class="big">∅</span>没有任何一行命中。<br>${
        s.key === "like" ? "字面上不包含这串字符。" : "查询里的词一个都不在索引里。"}`;
      list.appendChild(e);
      const n = el("div", "gate-note", s.note); list.appendChild(n);
      return;
    }
    if (kept === 0 && s.key !== "like") {
      const n = el("div", "gate-note");
      n.innerHTML = "⚠ 全部结果都低于置信门限 — 只匹配上 <code>airport</code> 这种到处都有的词。融合时全部丢弃。";
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
      row.innerHTML = `<span class="rk">${r.rank}</span>
        <span class="nm"><b>${mark(a.name, res.query, s.key)}</b>
          <span class="meta">${a.city} · ${a.country}${a.alt_ft || a.altFt
            ? " · " + (a.alt_ft ?? a.altFt).toLocaleString() + " ft" : ""}</span></span>
        <span class="iata">${a.iata || "—"}</span>
        <span class="bar"><i style="width:${Math.round((r.norm ?? 0) * 100)}%"></i></span>
        <span class="why">${fmtScore(s.key, r)}${r.why ? " · " + r.why : ""}</span>`;
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

  const fmtScore = (k, r) =>
    k === "vector" ? `sim ${r.score.toFixed(3)}`
    : k === "hybrid" ? `rrf ${r.score.toFixed(5)}`
    : k === "fulltext" ? `bm25 ${r.score.toFixed(2)}`
    : `score ${Math.round(r.score)}`;

  /** highlight the literal substring, but only where LIKE would see it */
  function mark(name, q, key) {
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    if (key !== "like") return esc(name);
    const i = name.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0 || !q.trim()) return esc(name);
    return esc(name.slice(0, i)) + "<em>" + esc(name.slice(i, i + q.trim().length)) + "</em>"
      + esc(name.slice(i + q.trim().length));
  }

  // ---------- verdict -----------------------------------------------------
  function paintVerdict(q, res) {
    const ids = {};
    STRATS.forEach((s) => {
      ids[s.key] = new Set((res.strategies[s.key].results || [])
        .filter((r) => !r.belowGate).map((r) => r.id));
    });
    const onlyVec = [...ids.vector].filter((i) => !ids.like.has(i) && !ids.fulltext.has(i));
    const onlyLex = [...new Set([...ids.like, ...ids.fulltext])].filter((i) => !ids.vector.has(i));
    const name = (id) => (AIRPORTS.find((a) => a.id === id)
      || (res.strategies.hybrid.results.find((r) => r.id === id) || {}).a || {}).iata || "?";

    const counts = STRATS.map((s) => {
      const all = (res.strategies[s.key].results || []).length;
      const good = ids[s.key].size;
      return `<b style="color:${s.css}">${s.label}</b> ${good}${all > good ? `<span style="opacity:.5">(+${all - good} 低置信)</span>` : ""}`;
    }).join(" &nbsp;·&nbsp; ");

    const preset = PRESETS.find((p) => p.q === q);
    const bits = [];
    if (onlyVec.length) bits.push(`<span class="only">只有语义检索找到：${onlyVec.slice(0, 6).map(name).join(" ")}</span>`);
    if (onlyLex.length) bits.push(`只有关键词找到：${onlyLex.slice(0, 6).map(name).join(" ")}`);
    if (!bits.length) bits.push("三种方式命中同一批结果 — 这类查询用哪种都行。");

    $("#verdict-body").innerHTML =
      `${counts}<br><span style="opacity:.85">${bits.join(" &nbsp;|&nbsp; ")}</span>`
      + (preset ? `<br><span style="color:var(--fg-faint)">💡 ${preset.hint}</span>` : "");
  }

  // ---------- sql ---------------------------------------------------------
  function paintSql() {
    $$(".sqltab").forEach((b) => b.classList.toggle("on", b.dataset.k === sqlTab));
    const q = (lastResult && lastResult.query) || "";
    const raw = SQL[sqlTab].replaceAll("@Q", q.replace(/'/g, "''"));
    $("#sql").innerHTML = raw
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
      .replace(/(--[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(SELECT|FROM|WHERE|ORDER BY|GROUP BY|LIMIT|JOIN|USING|WITH|AS|CASE|WHEN|THEN|ELSE|END|UNION ALL|OVER|SET|OR|AND|DESC|UPPER|LIKE|FIELD)\b/g,
        '<span class="kw">$1</span>')
      .replace(/\b(FTS_MATCH_WORD|VEC_COSINE_DISTANCE|ROW_NUMBER|SUM)\b/g, '<span class="fn">$1</span>')
      .replace(/('(?:[^']|'')*')/g, '<span class="st">$1</span>');
  }

  // ---------- globe tooltip ----------------------------------------------
  function showTip(a, x, y) {
    const tip = $("#globe-tip");
    if (!a) { tip.style.opacity = 0; return; }
    tip.innerHTML = `<b>${a.iata}</b> ${a.name}<br><span style="opacity:.65">${a.city} · ${a.country}</span>`;
    tip.style.left = x + "px"; tip.style.top = y + "px"; tip.style.opacity = 1;
  }
})();
