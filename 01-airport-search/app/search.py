"""The four retrieval strategies, one function each, plus timings.

Each function returns a list of dicts shaped like the web UI expects:
    {rank, id, name, city, country, iata, score, ...}

On timings: the embedding call is a network round trip to whatever model
provider you configured, and it is not TiDB. It is measured once, reported
separately as `embed_ms`, and kept out of the per-strategy numbers — a
comparison that quietly charged the vector column for an OpenAI round trip
would say far more about the API than about the database.
"""
import time
from typing import Any, Callable

from . import db
from .embeddings import embed_one, to_sql_vector

# How many rows each strategy returns. LIKE and full-text produce a finite
# set, so ten is "everything they found". A vector search always returns
# exactly k however bad the match is, and the hybrid list is the answer you
# would actually show a user — for those two, three.
LIMITS = {"like": 10, "fulltext": 10, "vector": 3, "hybrid": 3}
POOL = 20          # candidates each retriever contributes to the fusion
RRF_K = 60
WEIGHTS = {"like": 1.0, "fulltext": 1.0, "vector": 1.4}

# Plain RRF fuses ranks and ignores score magnitude, so a retriever that found
# nothing useful still votes with its rank-1 garbage. Gate on score first.
GATE_VECTOR = 0.58      # cosine-similarity floor — comparable across corpora
GATE_FTS_REL = 0.12     # fraction of this query's best BM25 score
GATE_FTS_ABS = 0.30     # ...and an absolute floor, because a query whose only
                        # match is a word every row contains has no best score
                        # worth being a fraction of. BM25 output is NOT
                        # normalised to 0..1, so this number is calibrated to
                        # this corpus — re-check it against your own.

COLS = "id, name, city, country, iata, icao, lat, lon, alt_ft, size_class"


def _timed(fn: Callable[..., list[dict]], *args) -> tuple[list[dict], float]:
    t0 = time.perf_counter()
    rows = fn(*args)
    return rows, (time.perf_counter() - t0) * 1000.0


def _like(s: str) -> str:
    """Escape LIKE wildcards. Without this, searching for "%" matches every
    row in the table and searching for "_" matches every single character.
    Parameter binding stops SQL injection; it does not stop this.
    """
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# --------------------------------------------------------------------- (1)
def search_like(q: str, limit: int = LIMITS["like"]) -> list[dict]:
    sql = f"""
        SELECT {COLS},
               CASE WHEN iata = UPPER(%(q)s)                   THEN 100
                    WHEN name LIKE CONCAT(%(lk)s, '%%')        THEN 80
                    WHEN city LIKE CONCAT(%(lk)s, '%%')        THEN 70
                    WHEN name LIKE CONCAT('%%', %(lk)s, '%%')  THEN 50
                    ELSE 30 END AS score
        FROM airports
        WHERE name    LIKE CONCAT('%%', %(lk)s, '%%')
           OR city    LIKE CONCAT('%%', %(lk)s, '%%')
           OR country LIKE CONCAT('%%', %(lk)s, '%%')
           OR iata    = UPPER(%(q)s)
           OR icao    = UPPER(%(q)s)
        ORDER BY score DESC, FIELD(size_class,'hub','large','regional'), name
        LIMIT %(n)s
    """
    return _rank(db.query(sql, {"q": q, "lk": _like(q), "n": limit}))


# --------------------------------------------------------------------- (2)
def search_fulltext(q: str, limit: int = LIMITS["fulltext"]) -> list[dict]:
    sql = f"""
        SELECT {COLS}, FTS_MATCH_WORD(%(q)s, doc) AS score
        FROM airports
        WHERE FTS_MATCH_WORD(%(q)s, doc)
        ORDER BY score DESC
        LIMIT %(n)s
    """
    return _rank(db.query(sql, {"q": q, "n": limit}))


# --------------------------------------------------------------------- (3)
def search_vector(q: str, qvec: str | None = None,
                  limit: int = LIMITS["vector"]) -> list[dict]:
    qvec = qvec or to_sql_vector(embed_one(q))
    sql = f"""
        SELECT {COLS}, 1 - VEC_COSINE_DISTANCE(doc_vec, %(v)s) AS score
        FROM airports
        ORDER BY VEC_COSINE_DISTANCE(doc_vec, %(v)s)
        LIMIT %(n)s
    """
    return _rank(db.query(sql, {"v": qvec, "n": limit}))


# --------------------------------------------------------------------- (4)
def search_hybrid(q: str, qvec: str | None = None,
                  limit: int = LIMITS["hybrid"]) -> list[dict]:
    """Reciprocal Rank Fusion, done in the database in a single statement."""
    qvec = qvec or to_sql_vector(embed_one(q))
    sql = f"""
        WITH
        fts_raw AS (
            SELECT id, FTS_MATCH_WORD(%(q)s, doc) AS s
            FROM airports
            WHERE FTS_MATCH_WORD(%(q)s, doc)
            ORDER BY s DESC
            LIMIT %(pool)s
        ),
        lex AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY
                       CASE WHEN iata = UPPER(%(q)s) THEN 0
                            WHEN name LIKE CONCAT(%(lk)s,'%%') THEN 1
                            ELSE 2 END,
                       FIELD(size_class,'hub','large','regional'), name) AS rnk
            FROM airports
            WHERE name LIKE CONCAT('%%', %(lk)s, '%%')
               OR city LIKE CONCAT('%%', %(lk)s, '%%')
               OR iata = UPPER(%(q)s)
            LIMIT %(pool)s
        ),
        fts AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY s DESC) AS rnk
            FROM fts_raw
            WHERE s >= %(gate_fts_abs)s
              AND s >= %(gate_fts_rel)s * (SELECT MAX(s) FROM fts_raw)
        ),
        vec AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY VEC_COSINE_DISTANCE(doc_vec, %(v)s)) AS rnk
            FROM (SELECT id, doc_vec FROM airports
                  WHERE 1 - VEC_COSINE_DISTANCE(doc_vec, %(v)s) >= %(gate_vec)s
                  ORDER BY VEC_COSINE_DISTANCE(doc_vec, %(v)s) LIMIT %(pool)s) t
        ),
        fused AS (
            SELECT id, SUM(w / (%(k)s + rnk)) AS rrf
            FROM (
                SELECT id, rnk, %(w_lex)s AS w FROM lex
                UNION ALL SELECT id, rnk, %(w_fts)s FROM fts
                UNION ALL SELECT id, rnk, %(w_vec)s FROM vec
            ) x
            GROUP BY id
        )
        SELECT a.id, a.name, a.city, a.country, a.iata, a.icao, a.lat, a.lon, a.alt_ft, a.size_class,
               f.rrf AS score,
               (SELECT rnk FROM lex WHERE lex.id = a.id) AS like_rank,
               (SELECT rnk FROM fts WHERE fts.id = a.id) AS fts_rank,
               (SELECT rnk FROM vec WHERE vec.id = a.id) AS vec_rank
        FROM fused f JOIN airports a ON a.id = f.id
        ORDER BY f.rrf DESC
        LIMIT %(n)s
    """
    params = {
        "q": q, "lk": _like(q), "v": qvec, "n": limit, "pool": POOL, "k": RRF_K,
        "w_lex": WEIGHTS["like"], "w_fts": WEIGHTS["fulltext"], "w_vec": WEIGHTS["vector"],
        "gate_fts_abs": GATE_FTS_ABS, "gate_fts_rel": GATE_FTS_REL,
        "gate_vec": GATE_VECTOR,
    }
    rows = _rank(db.query(sql, params))
    for r in rows:
        r["sources"] = [
            k for k, col in (("like", "like_rank"), ("fulltext", "fts_rank"), ("vector", "vec_rank"))
            if r.get(col) is not None
        ]
    return rows


def _rank(rows) -> list[dict]:
    out = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["rank"] = i
        d["score"] = float(d["score"]) if d.get("score") is not None else 0.0
        out.append(d)
    return out


def search_all(q: str, limits: dict[str, int] | None = None) -> dict[str, Any]:
    """Run all four and report per-strategy latency.

    The query is embedded ONCE, up front, and that cost is reported on its
    own. Two strategies need the vector; charging the first one to run for
    the whole model round trip would make the comparison meaningless.
    """
    limits = limits or LIMITS
    result: dict[str, Any] = {"query": q, "strategies": {}}

    qvec, embed_err = None, None
    t0 = time.perf_counter()
    try:
        qvec = to_sql_vector(embed_one(q))
    except Exception as exc:
        embed_err = str(exc)
    result["embed_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
    result["embed_error"] = embed_err

    plans: list[tuple[str, Callable[..., list[dict]], tuple]] = [
        ("like", search_like, (q, limits["like"])),
        ("fulltext", search_fulltext, (q, limits["fulltext"])),
        ("vector", search_vector, (q, qvec, limits["vector"])),
        ("hybrid", search_hybrid, (q, qvec, limits["hybrid"])),
    ]
    for key, fn, args in plans:
        if qvec is None and key in ("vector", "hybrid"):
            result["strategies"][key] = {
                "results": [], "took_ms": 0.0,
                "error": f"no embedding: {embed_err}"}
            continue
        try:
            rows, ms = _timed(fn, *args)
            result["strategies"][key] = {"results": rows, "took_ms": round(ms, 1), "error": None}
        except Exception as exc:  # a missing FTS index shouldn't kill the page
            result["strategies"][key] = {"results": [], "took_ms": 0.0, "error": str(exc)}
    return result
