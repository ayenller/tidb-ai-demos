-- =====================================================================
--  TiDB AI Demos / 01 - Airport Search
--  Schema: one table that is relational + full-text + vector at once.
--
--  Tested on TiDB Cloud Starter (full-text search and vector search are
--  available there today; on Dedicated, check your cluster version).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS airport_search;
USE airport_search;

DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS airports;

CREATE TABLE airports (
    id          INT           NOT NULL,
    name        VARCHAR(255)  NOT NULL,           -- "London Heathrow Airport"
    city        VARCHAR(128)  NOT NULL,           -- "London"
    country     VARCHAR(128)  NOT NULL,           -- "United Kingdom"
    iata        CHAR(3)       DEFAULT NULL,       -- "LHR"
    icao        CHAR(4)       DEFAULT NULL,       -- "EGLL"
    lat         DOUBLE        NOT NULL,
    lon         DOUBLE        NOT NULL,
    alt_ft      INT           NOT NULL DEFAULT 0,
    tz          VARCHAR(64)   DEFAULT NULL,

    -- Derived from route degree at load time. LIKE hands every matching row
    -- the same relevance, so *something* has to break the tie; busiest-first
    -- is what makes `LIKE '%london%'` return Heathrow before Gatwick.
    size_class  ENUM('hub','large','regional') NOT NULL DEFAULT 'regional',

    -- The searchable document. Everything a human might type is folded in
    -- here so that ONE full-text index and ONE embedding cover the row.
    -- e.g. "London Heathrow Airport LHR EGLL London United Kingdom
    --       Europe major hub transatlantic gateway"
    doc         TEXT          NOT NULL,

    -- Embedding of `doc`. 1536 dims = OpenAI text-embedding-3-small.
    -- Must be NOT NULL for a vector index to be usable.
    doc_vec     VECTOR(1536)  NOT NULL,

    PRIMARY KEY (id),
    KEY idx_iata (iata),
    KEY idx_country_city (country, city),

    -- (1) Full-text index. MULTILINGUAL handles CJK + latin in one index.
    FULLTEXT INDEX ft_doc (doc) WITH PARSER MULTILINGUAL,

    -- (2) Vector index (HNSW). Cosine distance to match the embeddings we store.
    VECTOR INDEX idx_doc_vec ((VEC_COSINE_DISTANCE(doc_vec)))
);

-- Vector indexes are served from the columnar replica.
ALTER TABLE airports SET TIFLASH REPLICA 1;

-- Routes are here so the demo page can draw real flight arcs, and so demo 02
-- (flight RAG) can join structured filters onto the same search results.
CREATE TABLE routes (
    -- AUTO_RANDOM has to sit on the primary key column itself
    id            BIGINT AUTO_RANDOM PRIMARY KEY,
    airline       VARCHAR(16)  NOT NULL,
    src_iata      CHAR(3)      NOT NULL,
    dst_iata      CHAR(3)      NOT NULL,
    stops         TINYINT      NOT NULL DEFAULT 0,
    equipment     VARCHAR(64)  DEFAULT NULL,
    KEY idx_src (src_iata),
    KEY idx_dst (dst_iata)
);
