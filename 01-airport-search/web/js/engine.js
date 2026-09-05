/* =====================================================================
 *  engine.js — the four retrievers, running entirely in your browser.
 *
 *  (1) LIKE      : real substring matching. Identical semantics to
 *                  `WHERE name LIKE '%q%'` in sql/02_queries.sql.
 *  (2) FULL-TEXT : a real BM25 implementation over the same `doc` field
 *                  that TiDB's FULLTEXT index would build.
 *  (3) VECTOR    : SIMULATED. A browser cannot run an embedding model, so
 *                  this approximates one with concept tags + fuzzy
 *                  matching. It reproduces the *behaviour* of semantic
 *                  search (typo tolerance, cross-language, paraphrase) so
 *                  the comparison is meaningful — but it is not a real
 *                  embedding. Point the page at the FastAPI backend to
 *                  get true VEC_COSINE_DISTANCE results from TiDB.
 *  (4) HYBRID    : real Reciprocal Rank Fusion over the three lists —
 *                  the exact same arithmetic as the SQL version.
 * ===================================================================== */
const Engine = (() => {
  const K_RRF = 60;
  const POOL = 20;
  const WEIGHTS = { like: 1.0, fulltext: 1.0, vector: 1.4 };
  // Plain RRF fuses ranks and ignores score magnitude — so a retriever that
  // found nothing useful still gets to vote with its rank-1 garbage. Real
  // systems gate on score before fusing. These two numbers are that gate.
  const GATE = {
    vector: 0.58,        // absolute similarity floor
    fulltextRel: 0.12,   // fraction of this query's top BM25 score
    fulltextAbs: 0.30,   // and an absolute floor: matching only the word
                         // "airport" is not a match, however you rank it
  };
  const STOP = new Set(["a","an","the","of","in","on","at","to","for","and","or",
    "is","are","with","where","that","near","by","from","it","its","as","be"]);

  // ---------- tokenisation -------------------------------------------------
  const deaccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  /** Latin words + CJK unigrams/bigrams, so 中文 queries tokenise usefully. */
  function tokenize(text) {
    const s = deaccent(String(text).toLowerCase());
    const out = [];
    for (const m of s.matchAll(/[a-z0-9]+|[㐀-鿿぀-ヿ가-힯]+/g)) {
      const t = m[0];
      if (/^[a-z0-9]+$/.test(t)) {
        if (!STOP.has(t)) out.push(stem(t));
      } else {
        for (const ch of t) out.push(ch);                     // unigrams
        for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); // bigrams
      }
    }
    return out;
  }

  /** Deliberately crude stemmer — enough for plurals and -ing/-ed. */
  function stem(w) {
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    // only a real English plural loses the whole "es" — otherwise "andes"
    // stems to "and", which is a stopword, and the Andes query dies quietly
    if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }

  function trigrams(s) {
    const t = ` ${deaccent(s.toLowerCase())} `;
    const g = new Set();
    for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
    return g;
  }
  function trigramSim(a, b) {
    const A = trigrams(a), B = trigrams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const g of A) if (B.has(g)) hit++;
    return hit / (A.size + B.size - hit);   // Jaccard
  }

  // ---------- index --------------------------------------------------------
  let docs = [];        // BM25 corpus, built from airport.doc
  let sem = [];         // semantic corpus (doc + tags + aliases)  [offline only]
  let df = new Map(), semDf = new Map();
  let avgdl = 0, N = 0;

  function build(airports) {
    N = airports.length;
    docs = []; sem = []; df = new Map(); semDf = new Map();
    let total = 0;
    airports.forEach((a, i) => {
      const dt = tokenize(a.doc);
      // "·" separators matter: without them the concatenation of doc + tags
      // invents adjacencies ("... very large airport" + "andes" reads as the
      // phrase "airport andes") and those fake phrases win concept matches.
      const semText = [a.doc, ...a.tags, ...a.aliases].join(" · ");
      const st = tokenize(semText);
      total += dt.length;
      const tf = new Map();
      for (const t of dt) tf.set(t, (tf.get(t) || 0) + 1);
      docs[i] = { tf, len: dt.length };
      const stf = new Map();
      for (const t of st) stf.set(t, (stf.get(t) || 0) + 1);
      sem[i] = { tf: stf, text: semText.toLowerCase() };
      for (const t of new Set(dt)) df.set(t, (df.get(t) || 0) + 1);
      for (const t of new Set(st)) semDf.set(t, (semDf.get(t) || 0) + 1);
    });
    avgdl = total / N;
  }

  const idf = (map, t) => {
    const n = map.get(t) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  // ---------- (1) LIKE -----------------------------------------------------
  function like(airports, q, limit = 10) {
    const needle = q.trim().toLowerCase();
    const upper = q.trim().toUpperCase();
    if (!needle) return [];
    const hits = [];
    airports.forEach((a) => {
      const inName = a.name.toLowerCase().includes(needle);
      const inCity = a.city.toLowerCase().includes(needle);
      const inCountry = a.country.toLowerCase().includes(needle);
      const isCode = a.iata === upper || a.icao === upper;
      if (!(inName || inCity || inCountry || isCode)) return;
      let score = 30;                                   // mirrors the SQL CASE
      if (isCode) score = 100;
      else if (a.name.toLowerCase().startsWith(needle)) score = 80;
      else if (a.city.toLowerCase().startsWith(needle)) score = 70;
      else if (inName) score = 50;
      hits.push({ a, score, why: isCode ? "code match"
        : inName ? "substring in name" : inCity ? "substring in city" : "substring in country" });
    });
    // LIKE gives every matching row the same "relevance", so the tie-break is
    // pure guesswork. Busiest-first is the least-bad guess — and it is the one
    // thing that makes `LIKE '%london%'` return Heathrow before Gatwick.
    hits.sort((x, y) => y.score - x.score || SIZE[x.a.size] - SIZE[y.a.size]
                        || x.a.name.localeCompare(y.a.name));
    return finish(hits.slice(0, limit), 100);
  }

  // ---------- (2) FULL-TEXT (BM25) ----------------------------------------
  function fulltext(airports, q, limit = 10) {
    const qt = [...new Set(tokenize(q))];
    if (!qt.length) return [];
    const k1 = 1.2, b = 0.75;
    const hits = [];
    airports.forEach((a, i) => {
      let s = 0; const matched = [];
      for (const t of qt) {
        const f = docs[i].tf.get(t);
        if (!f) continue;
        matched.push(t);
        s += idf(df, t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docs[i].len / avgdl));
      }
      if (s > 0) hits.push({ a, score: s, why: `BM25 · matched ${matched.join(", ")}` });
    });
    hits.sort((x, y) => y.score - x.score);
    const max = hits.length ? hits[0].score : 1;
    return finish(hits.slice(0, limit), max);
  }

  // ---------- (3) VECTOR (simulated) --------------------------------------
  function vector(airports, q, limit = 10) {
    const qt = [...new Set(tokenize(q))];
    const phrases = latinPhrases(q);
    if (!qt.length) return [];
    const raw = airports.map((a, i) => {
      let s = 0; const why = [];
      // concept overlap, IDF-weighted. A lone CJK character is mostly noise
      // (every Chinese airport name ends in 机场), so it counts for little;
      // the character bigram is the real unit of meaning.
      for (const t of qt) {
        if (sem[i].tf.has(t)) s += idf(semDf, t) * (isCjkChar(t) ? 0.25 : 1);
      }
      // phrase hits ("silicon valley") count for a lot — that is the part a
      // keyword index cannot do, because the phrase is nowhere in the data.
      for (const p of phrases) {
        if (sem[i].text.includes(p)) { s += 3.5; why.push(`concept "${p}"`); }
      }
      // fuzzy: the typo-tolerance an embedding gives you for free
      let fuzz = 0;
      for (const t of qt) {
        if (t.length < 4) continue;
        for (const cand of [a.name, a.city, a.country, a.iata || ""]) {
          // split on punctuation too, or "Airport," reads as a typo of "airport"
          for (const w of deaccent(cand.toLowerCase()).split(/[^a-z0-9]+/)) {
            const sim = trigramSim(t, w);
            if (sim > 0.45 && sim < 0.999) fuzz = Math.max(fuzz, sim);
          }
        }
      }
      if (fuzz > 0) { s += fuzz * 6; why.push(`fuzzy ~${fuzz.toFixed(2)}`); }
      // popularity prior — big hubs sit in denser neighbourhoods
      s += { hub: 0.9, large: 0.4, regional: 0 }[a.size];
      return { a, score: s, why: why.join(" · ") || "semantic neighbourhood" };
    });
    // A vector search ALWAYS returns k rows. There is no "no match" — that is
    // exactly why it needs a keyword partner. We keep that behaviour.
    raw.sort((x, y) => y.score - x.score || SIZE[x.a.size] - SIZE[y.a.size]
                       || x.a.name.localeCompare(y.a.name));
    // Squash to an absolute 0..0.95 "similarity" so that GATE.vector means the
    // same thing for every query — a max-relative scale would let a query with
    // no good answer at all promote its least-bad row.
    return finish(raw.slice(0, limit).map((r) => ({
      ...r, score: 0.35 + 0.55 * (1 - Math.exp(-r.score / 6)),
    })), 1);
  }

  const isCjkChar = (t) => t.length === 1 && /[㐀-鿿぀-ヿ가-힯]/.test(t);

  /** Content-word n-grams of the query, used for concept hits.
   *  Stopwords are dropped FIRST — otherwise "highest airport in the Andes"
   *  produces the phrase "in the", which matches "busiest airport in the
   *  world" and hands Atlanta a top-3 slot in an Andes query. */
  function latinPhrases(q) {
    const w = (deaccent(q.toLowerCase()).match(/[a-z0-9]+/g) || [])
      .filter((x) => !STOP.has(x));
    const out = [];
    for (let n = 2; n <= 3; n++)
      for (let i = 0; i + n <= w.length; i++) {
        const parts = w.slice(i, i + n);
        // at least one reasonably rare word, or it is not a concept
        if (Math.max(...parts.map((x) => idf(semDf, stem(x)))) < 1.0) continue;
        out.push(parts.join(" "));
      }
    return out;
  }

  // ---------- (4) HYBRID (RRF) --------------------------------------------
  /** Drop candidates the retriever is not actually confident about. */
  function gated(key, rows) {
    if (key === "vector") return rows.filter((r) => r.score >= GATE.vector);
    if (key === "fulltext") {
      const top = rows.length ? rows[0].score : 0;
      return rows.filter((r) => r.score >= Math.max(GATE.fulltextAbs, GATE.fulltextRel * top));
    }
    return rows;
  }

  function hybrid(lists, limit = 10) {
    const fused = new Map();
    for (const [key, rows] of Object.entries(lists)) {
      gated(key, rows).slice(0, POOL).forEach((r, i) => {
        const rank = i + 1;
        const e = fused.get(r.id) || { row: r, rrf: 0, sources: {}, };
        e.rrf += WEIGHTS[key] / (K_RRF + rank);
        e.sources[key] = rank;
        if (!e.row.a) e.row = r;
        fused.set(r.id, e);
      });
    }
    const out = [...fused.values()].sort((x, y) => y.rrf - x.rrf).slice(0, limit);
    const max = out.length ? out[0].rrf : 1;
    return out.map((e, i) => ({
      ...e.row,
      rank: i + 1,
      score: e.rrf,
      norm: e.rrf / max,
      sources: e.sources,
      why: Object.entries(e.sources).map(([k, v]) => `${LABEL[k]}#${v}`).join(" + "),
    }));
  }

  const SIZE = { hub: 0, large: 1, regional: 2 };
  const LABEL = { like: "LIKE", fulltext: "FTS", vector: "VEC" };

  /** Tag rows the gate would have thrown away, so the UI can dim them. */
  function mark(key, rows) {
    const kept = new Set(gated(key, rows).map((r) => r.id));
    return rows.map((r) => ({ ...r, belowGate: !kept.has(r.id) }));
  }

  function finish(hits, max) {
    return hits.map((h, i) => ({
      id: h.a.id, a: h.a, rank: i + 1,
      score: h.score, norm: max ? Math.min(1, h.score / max) : 0,
      why: h.why,
    }));
  }

  // ---------- public -------------------------------------------------------
  function searchAll(airports, q, limit = 10) {
    const t0 = performance.now();
    const lk = like(airports, q, POOL);
    const ft = fulltext(airports, q, POOL);
    const vc = vector(airports, q, POOL);
    const hy = hybrid({ like: lk, fulltext: ft, vector: vc }, limit);
    return {
      query: q,
      tookMs: performance.now() - t0,
      strategies: {
        like: { results: lk.slice(0, limit) },
        fulltext: { results: mark("fulltext", ft).slice(0, limit) },
        vector: { results: mark("vector", vc).slice(0, limit) },
        hybrid: { results: hy },
      },
    };
  }

  return { build, searchAll, tokenize, trigramSim, WEIGHTS, K_RRF, GATE };
})();
