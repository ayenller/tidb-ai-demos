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
--                      the Andes", "机场 靠近 硅谷").
-- Where it falls over : short opaque tokens. 'JFK' as an embedding is
--                       close to lots of unrelated airports, and it will
--                       happily return 10 rows for a query that should
--                       have returned nothing — there is no "no match".
-- Cost               : HNSW index on the columnar replica.
-- ---------------------------------------------------------------------
SELECT id, name, city, country, iata,
       1 - VEC_COSINE_DISTANCE(doc_vec, :q_vec) AS score   -- cosine similarity
FROM airports
ORDER BY VEC_COSINE_DISTANCE(doc_vec, :q_vec)              -- ASC = nearest
LIMIT 10;


-- ---------------------------------------------------------------------
-- (4) HYBRID  —  Reciprocal Rank Fusion over all three
--
--     rrf_score(d) = SUM over each retriever r of  weight_r / (k + rank_r(d))
--
-- RRF fuses *ranks*, not scores, so you never have to normalise a BM25
-- score against a cosine similarity against a hand-made CASE expression.
-- k = 60 is the standard constant; it damps the tail so that being #1 in
-- one list beats being #4 in two lists only slightly.
--
-- This is one query, one round trip, one transaction-consistent snapshot.
-- ---------------------------------------------------------------------
WITH
lex AS (            -- (1) LIKE candidates
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
fts AS (            -- (2) full-text candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY FTS_MATCH_WORD(:q, doc) DESC) AS rnk
    FROM airports
    WHERE FTS_MATCH_WORD(:q, doc)
    LIMIT 20
),
vec AS (            -- (3) vector candidates
    SELECT id, ROW_NUMBER() OVER (ORDER BY VEC_COSINE_DISTANCE(doc_vec, :q_vec)) AS rnk
    FROM (
        SELECT id, doc_vec
        FROM airports
        ORDER BY VEC_COSINE_DISTANCE(doc_vec, :q_vec)
        LIMIT 20
    ) t
),
fused AS (
    SELECT id,
           SUM(w / (60 + rnk)) AS rrf
    FROM (
        SELECT id, rnk, 1.0 AS w FROM lex
        UNION ALL
        SELECT id, rnk, 1.0 AS w FROM fts
        UNION ALL
        SELECT id, rnk, 1.2 AS w FROM vec   -- tune per dataset
    ) all_lists
    GROUP BY id
)
SELECT a.id, a.name, a.city, a.country, a.iata,
       f.rrf AS score,
       -- provenance: which retrievers voted for this row?
       (SELECT rnk FROM lex WHERE lex.id = a.id) AS like_rank,
       (SELECT rnk FROM fts WHERE fts.id = a.id) AS fts_rank,
       (SELECT rnk FROM vec WHERE vec.id = a.id) AS vec_rank
FROM fused f
JOIN airports a ON a.id = f.id
ORDER BY f.rrf DESC
LIMIT 10;


-- ---------------------------------------------------------------------
-- Bonus: the thing a dedicated vector database cannot do.
-- Semantic search WITH a relational predicate and a join, transactionally
-- consistent, in one statement:
--
--   "airports that feel like a high-altitude mountain hub, above 8000 ft,
--    that actually have more than 50 outbound routes"
-- ---------------------------------------------------------------------
SELECT a.name, a.city, a.country, a.alt_ft, COUNT(r.id) AS out_routes,
       1 - VEC_COSINE_DISTANCE(a.doc_vec, :q_vec) AS similarity
FROM airports a
JOIN routes r ON r.src_iata = a.iata
WHERE a.alt_ft > 8000
GROUP BY a.id, a.name, a.city, a.country, a.alt_ft, a.doc_vec
HAVING out_routes > 50
ORDER BY VEC_COSINE_DISTANCE(a.doc_vec, :q_vec)
LIMIT 10;
