"""FastAPI app: serves the demo page and the /api/search endpoint.

    uvicorn app.main:app --reload --port 8000
    open http://localhost:8000
"""
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db, search

WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="TiDB Airport Search Demo")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/api/health")
def health():
    try:
        with db.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM airports")
            n = cur.fetchone()["n"]
        return {"ok": True, "airports": n}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/search")
def api_search(q: str = Query(..., min_length=1), limit: int = 10):
    return search.search_all(q, limit)


@app.get("/api/airports")
def api_airports(limit: int = 400):
    """Points for the globe."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT id, name, city, country, iata, lat, lon FROM airports "
            "WHERE iata IS NOT NULL ORDER BY id LIMIT %s",
            (limit,),
        )
        return cur.fetchall()


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
