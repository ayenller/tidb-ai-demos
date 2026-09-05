# TiDB AI Demos

A collection of small, self-contained demos showing what TiDB can do as an **AI / search database** —
one database that speaks SQL, full-text search, and vector search at the same time.

Every demo is built so you can:

1. **Look at it first** — each demo ships a zero-dependency web page that runs offline on a
   built-in sample dataset. No cluster, no API key, no build step.
2. **Then run it for real** — the same demo ships the schema, the loader, and the exact SQL
   against a real TiDB Cloud cluster.

## Demos

| # | Demo | What it shows | Status |
|---|------|---------------|--------|
| [01](./01-airport-search) | **Airport Search: 4 ways to retrieve** | The same query run through `LIKE`, full-text (BM25), vector (semantic), and a hybrid RRF fusion — side by side, on the OpenFlights airport dataset. | ✅ Ready |
| 02 | _Flight RAG assistant_ | Retrieval-augmented Q&A over routes + airports | 🚧 Planned |
| 03 | _Realtime vector ingestion_ | Streaming embeddings into TiDB, HTAP freshness | 🚧 Planned |

## Why TiDB for this

Most "AI search" stacks need three systems: a relational database for the facts, an inverted
index for keywords, and a vector database for embeddings — plus glue to keep them in sync.

TiDB collapses that into one table:

```sql
CREATE TABLE airports (
  id        INT PRIMARY KEY,
  name      VARCHAR(255),
  lat       DOUBLE,                     -- relational
  doc       TEXT,                       -- full-text
  doc_vec   VECTOR(1536),               -- vector
  FULLTEXT INDEX ft_doc (doc) WITH PARSER MULTILINGUAL,
  VECTOR INDEX idx_vec ((VEC_COSINE_DISTANCE(doc_vec)))
);
```

One transaction writes all three. One query joins across all three. No sync lag, no dual writes,
no "which store is the source of truth" problem.

## Getting started

```bash
git clone <this-repo>
cd 01-airport-search
python3 scripts/dev_server.py 8137     # then open http://localhost:8137
```

No database, no API key, no build step — the page ships with a real sample dataset
and runs every retriever in the browser. To point it at a real TiDB cluster instead,
see the demo's own [README](./01-airport-search/README.md).

## License

MIT
