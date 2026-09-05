-- =====================================================================
--  The four retrieval strategies, as literal SQL.
--
--  Every query below answers the same question: "which airports match
--  what the user typed?" — and they disagree, which is the whole point.
--
--  :q      = the raw user string, e.g. 'heathrow'
--  :q_vec  = the embedding of :q, e.g. '[0.013,-0.442,...]'
-- =====================================================================
USE airport_search;

-- ---------------------------------------------------------------------
-- (1) LIKE  —  substring matching
--
-- What it is good at : exact codes and prefixes. 'JFK', 'Heathrow', 'SFO'.
-- Where it falls over : word order ('heathrow london'), typos ('heathow'),
--                       synonyms, any other language, and ranking — every
--                       row is equally "matched", so you invent an ORDER BY.
-- Cost               : no index can serve a leading-wildcard '%x%', so this
--                       is a full scan. Fine at 7k rows, fatal at 70M.
-- ---------------------------------------------------------------------
SELECT id, name, city, country, iata,
       -- hand-rolled ranking, because LIKE gives you no score at all
       CASE
           WHEN iata = UPPER(:q)                    THEN 100
           WHEN name LIKE CONCAT(:q, '%')           THEN 80
           WHEN city LIKE CONCAT(:q, '%')           THEN 70
           WHEN name LIKE CONCAT('%', :q, '%')      THEN 50
           ELSE 30
       END AS score
FROM airports
WHERE name    LIKE CONCAT('%', :q, '%')
   OR city    LIKE CONCAT('%', :q, '%')
   OR country LIKE CONCAT('%', :q, '%')
   OR iata    = UPPER(:q)
   OR icao    = UPPER(:q)
ORDER BY score DESC, FIELD(size_class,'hub','large','regional'), name
LIMIT 10;


-- ---------------------------------------------------------------------
-- (2) FULL-TEXT  —  tokenised, BM25-ranked
--
-- What it is good at : multi-word queries in any order, real relevance
--                      ranking, stopword handling, CJK segmentation.
-- Where it falls over : it still matches *tokens*. A typo is a different
--                       token. A synonym is a different token. "airport
--                       near Silicon Valley" matches every row containing
--                       the word "airport".
-- Cost               : inverted index, sublinear.
-- ---------------------------------------------------------------------
SELECT id, name, city, country, iata,
       FTS_MATCH_WORD(:q, doc) AS score      -- BM25 relevance
FROM airports
WHERE FTS_MATCH_WORD(:q, doc)
ORDER BY score DESC
LIMIT 10;


-- ---------------------------------------------------------------------
-- (3) VECTOR  —  semantic / embedding similarity
--
-- What it is good at : meaning. Typos, paraphrases, cross-language,
--                      descriptions instead of names ("windy airport in
--                      the Andes", "安第斯山脉海拔最高的机场",
--                      "aeroporto perto do Vale do Silício").
-- Where it falls over : short opaque tokens. 'JFK' as an embedding is
--                       close to lots of unrelated airports.
-- Cost               : HNSW index on the columnar replica.
--
-- Note what is NOT in this query: a WHERE clause. A vector search always
-- returns exactly LIMIT rows, however far away the nearest neighbours
-- are. There is no "no match" — which is exactly why it needs a keyword
-- partner, and why the fusion below gates it on score.
-- ---------------------------------------------------------------------

-- The application embeds the query string first — the one step that
-- happens outside the database. 1536 floats for text-embedding-3-small.
SET @qv = '[0.0131,-0.4422, ... 1532 more ... ,0.0917]';   -- = embed(:q)

SELECT id, name, city, country, iata, icao, alt_ft, size_class,
       1 - VEC_COSINE_DISTANCE(doc_vec, @qv) AS similarity
FROM airports
ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)     -- ASC: nearest neighbour first
LIMIT 3;

-- How to confirm the vector index is actually being used (rather than a
-- brute-force scan, which returns the same rows and is far slower):
--
--   EXPLAIN SELECT id FROM airports
--    ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv) LIMIT 3;
--   -- look for  annIndex:COSINE(doc_vec..)  in the TableFullScan operator
--
-- And to check the index has finished building after a bulk load:
--
--   SELECT * FROM information_schema.tiflash_indexes
--    WHERE table_name = 'airports';


-- ---------------------------------------------------------------------
-- (4) HYBRID  —  Reciprocal Rank Fusion over all three
--
--     rrf(d) = SUM over each retriever r of   weight_r / (k + rank_r(d))
--
-- RRF fuses *ranks*, not scores, so a BM25 score, a cosine similarity and
-- a hand-made CASE expression never have to be normalised onto a common
-- scale — a problem that is genuinely hard to solve well.
--
-- k = 60 is the standard constant; it damps the tail, so being #1 in one
-- list beats being #4 in two lists only slightly.
--
-- The score gates are the part most write-ups leave out. Plain RRF looks
-- only at rank, so a retriever that found nothing useful still gets to
-- vote with its rank-1 garbage. Without the gates, "airport near Silicon
-- Valley" is decided by ten BM25 rows whose only shared word is "airport".
--
-- @gv is comparable across corpora: cosine similarity is bounded. @gfa is
-- not — BM25 output is unnormalised, so an absolute floor has to be
-- calibrated against your own data. 0.30 is calibrated for this one.
--
-- One statement. One round trip. One transaction-consistent snapshot.
-- ---------------------------------------------------------------------
SET @qv  = '[0.0131,-0.4422, ... 1532 more ... ,0.0917]';   -- = embed(:q)
SET @k   = 60;      -- RRF constant
SET @gv  = 0.58;    -- vector gate: cosine-similarity floor
SET @gfa = 0.30;    -- full-text gate: absolute BM25 floor
SET @gfr = 0.12;    -- full-text gate: fraction of this query's best score
-- The candidate pool stays a literal 20 in each CTE below: LIMIT does not
-- accept a user variable outside a prepared statement.

WITH
lex AS (                                    -- (1) LIKE candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY
               CASE WHEN iata = UPPER(:q) THEN 0
                    WHEN name LIKE CONCAT(:q,'%') THEN 1
                    ELSE 2 END,
               FIELD(size_class,'hub','large','regional'), name) AS rnk
    FROM airports
    WHERE name LIKE CONCAT('%', :q, '%')
       OR city LIKE CONCAT('%', :q, '%')
       OR iata = UPPER(:q)
    LIMIT 20
),
fts_raw AS (                                -- (2) full-text candidates
    SELECT id, FTS_MATCH_WORD(:q, doc) AS s
    FROM airports
    WHERE FTS_MATCH_WORD(:q, doc)
    ORDER BY s DESC
    LIMIT 20
),
fts AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY s DESC) AS rnk
    FROM fts_raw
    WHERE s >= @gfa                                   -- absolute floor
      AND s >= @gfr * (SELECT MAX(s) FROM fts_raw)    -- and relative to the
),                                                    -- best score this query got
vec AS (                                    -- (3) vector candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)) AS rnk
    FROM (
        SELECT id, doc_vec
        FROM airports
        WHERE 1 - VEC_COSINE_DISTANCE(doc_vec, @qv) >= @gv    -- gate
        ORDER BY VEC_COSINE_DISTANCE(doc_vec, @qv)
        LIMIT 20
    ) t
),
fused AS (
    SELECT id, SUM(w / (@k + rnk)) AS rrf
    FROM (
        SELECT id, rnk, 1.0 AS w FROM lex
        UNION ALL
        SELECT id, rnk, 1.0 AS w FROM fts
        UNION ALL
        SELECT id, rnk, 1.4 AS w FROM vec      -- weights are per-dataset
    ) all_lists
    GROUP BY id
)
SELECT a.id, a.name, a.city, a.country, a.iata, a.icao, a.alt_ft, a.size_class,
       f.rrf AS score,
       -- provenance: which retrievers voted for this row, and how highly?
       (SELECT rnk FROM lex WHERE lex.id = a.id) AS like_rank,
       (SELECT rnk FROM fts WHERE fts.id = a.id) AS fts_rank,
       (SELECT rnk FROM vec WHERE vec.id = a.id) AS vec_rank
FROM fused f
JOIN airports a ON a.id = f.id
ORDER BY f.rrf DESC
LIMIT 3;                                    -- the answer a user actually sees


-- ---------------------------------------------------------------------
-- Bonus: the thing a dedicated vector database cannot do.
-- Semantic search WITH a relational predicate and a join, transactionally
-- consistent, in one statement:
--
--   "airports that feel like a high-altitude mountain hub, above 8000 ft,
--    that actually have more than 50 outbound routes"
-- ---------------------------------------------------------------------
SELECT a.name, a.city, a.country, a.alt_ft, COUNT(r.id) AS out_routes,
       1 - VEC_COSINE_DISTANCE(a.doc_vec, @qv) AS similarity
FROM airports a
JOIN routes r ON r.src_iata = a.iata
WHERE a.alt_ft > 8000                              -- relational filter
GROUP BY a.id, a.name, a.city, a.country, a.alt_ft, a.doc_vec
HAVING out_routes > 50                             -- aggregate filter
ORDER BY VEC_COSINE_DISTANCE(a.doc_vec, @qv)       -- semantic ranking
LIMIT 10;
