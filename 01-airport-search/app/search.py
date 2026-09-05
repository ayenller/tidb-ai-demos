"""The four retrieval strategies, one function each, plus timings.

Each function returns a list of dicts shaped like the web UI expects:
    {rank, id, name, city, country, iata, score, ...}
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
GATE_VECTOR = 0.58      # cosine-similarity floor
GATE_FTS = 0.30         # BM25 floor: matching only the word "airport" is not
                        # a match, however it ranks

COLS = "id, name, city, country, iata, icao, lat, lon, alt_ft, size_class"


def _timed(fn: Callable[..., list[dict]], *args) -> tuple[list[dict], float]:
    t0 = time.perf_counter()
    rows = fn(*args)
    return rows, (time.perf_counter() - t0) * 1000.0


# --------------------------------------------------------------------- (1)
def search_like(q: str, limit: int = LIMITS["like"]) -> list[dict]:
    sql = f"""
        SELECT {COLS},
               CASE WHEN iata = UPPER(%(q)s)                   THEN 100
                    WHEN name LIKE CONCAT(%(q)s, '%%')         THEN 80
                    WHEN city LIKE CONCAT(%(q)s, '%%')         THEN 70
                    WHEN name LIKE CONCAT('%%', %(q)s, '%%')   THEN 50
                    ELSE 30 END AS score
        FROM airports
        WHERE name    LIKE CONCAT('%%', %(q)s, '%%')
           OR city    LIKE CONCAT('%%', %(q)s, '%%')
           OR country LIKE CONCAT('%%', %(q)s, '%%')
           OR iata    = UPPER(%(q)s)
           OR icao    = UPPER(%(q)s)
        ORDER BY score DESC, FIELD(size_class,'hub','large','regional'), name
        LIMIT %(n)s
    """
    with db.cursor() as cur:
        cur.execute(sql, {"q": q, "n": limit})
        return _rank(cur.fetchall())


# --------------------------------------------------------------------- (2)
def search_fulltext(q: str, limit: int = LIMITS["fulltext"]) -> list[dict]:
    sql = f"""
        SELECT {COLS}, FTS_MATCH_WORD(%(q)s, doc) AS score
        FROM airports
        WHERE FTS_MATCH_WORD(%(q)s, doc)
        ORDER BY score DESC
        LIMIT %(n)s
    """
    with db.cursor() as cur:
        cur.execute(sql, {"q": q, "n": limit})
        return _rank(cur.fetchall())


# --------------------------------------------------------------------- (3)
def search_vector(q: str, limit: int = LIMITS["vector"]) -> list[dict]:
    qvec = to_sql_vector(embed_one(q))
    sql = f"""
        SELECT {COLS}, 1 - VEC_COSINE_DISTANCE(doc_vec, %(v)s) AS score
        FROM airports
        ORDER BY VEC_COSINE_DISTANCE(doc_vec, %(v)s)
        LIMIT %(n)s
    """
    with db.cursor() as cur:
        cur.execute(sql, {"v": qvec, "n": limit})
        return _rank(cur.fetchall())


# --------------------------------------------------------------------- (4)
def search_hybrid(q: str, limit: int = LIMITS["hybrid"]) -> list[dict]:
    """Reciprocal Rank Fusion, done in the database in a single statement."""
    qvec = to_sql_vector(embed_one(q))
    sql = f"""
        WITH
        lex AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY
                       CASE WHEN iata = UPPER(%(q)s) THEN 0
                            WHEN name LIKE CONCAT(%(q)s,'%%') THEN 1
                            ELSE 2 END,
                       FIELD(size_class,'hub','large','regional'), name) AS rnk
            FROM airports
            WHERE name LIKE CONCAT('%%', %(q)s, '%%')
               OR city LIKE CONCAT('%%', %(q)s, '%%')
               OR iata = UPPER(%(q)s)
            LIMIT %(pool)s
        ),
        fts AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY FTS_MATCH_WORD(%(q)s, doc) DESC) AS rnk
            FROM airports
            WHERE FTS_MATCH_WORD(%(q)s, doc)
              AND FTS_MATCH_WORD(%(q)s, doc) >= %(gate_fts)s
            LIMIT %(pool)s
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
        "q": q, "v": qvec, "n": limit, "pool": POOL, "k": RRF_K,
        "w_lex": WEIGHTS["like"], "w_fts": WEIGHTS["fulltext"], "w_vec": WEIGHTS["vector"],
        "gate_fts": GATE_FTS, "gate_vec": GATE_VECTOR,
    }
    with db.cursor() as cur:
        cur.execute(sql, params)
        rows = _rank(cur.fetchall())
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
    """Run all four and report per-strategy latency."""
    limits = limits or LIMITS
    result: dict[str, Any] = {"query": q, "strategies": {}}
    for key, fn in (
        ("like", search_like),
        ("fulltext", search_fulltext),
        ("vector", search_vector),
        ("hybrid", search_hybrid),
    ):
        try:
            rows, ms = _timed(fn, q, limits[key])
            result["strategies"][key] = {"results": rows, "took_ms": round(ms, 1), "error": None}
        except Exception as exc:  # a missing FTS index shouldn't kill the page
            result["strategies"][key] = {"results": [], "took_ms": 0.0, "error": str(exc)}
    return result
