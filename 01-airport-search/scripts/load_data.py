#!/usr/bin/env python3
"""Download the OpenFlights dataset, build the searchable doc, embed it,
and load everything into TiDB.

    python -m scripts.load_data --limit 1500     # cheap first run
    python -m scripts.load_data                  # all ~7.7k airports

Costs: 7.7k docs x ~40 tokens with text-embedding-3-small is a few cents.
"""
import argparse
import csv
import io
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db                              # noqa: E402
from app.embeddings import embed, to_sql_vector  # noqa: E402

BASE = "https://raw.githubusercontent.com/jpatokal/openflights/master/data"
AIRPORTS_URL = f"{BASE}/airports.dat"
ROUTES_URL = f"{BASE}/routes.dat"
DATA = Path(__file__).resolve().parent.parent / "data"

# Rough continent hints so that "airport in the Andes" or "European hub" has
# something to latch onto semantically. Cheap, and it measurably helps recall.
REGION_BY_TZ = {
    "Europe": "Europe European",
    "Asia": "Asia Asian",
    "America": "Americas",
    "Africa": "Africa African",
    "Australia": "Oceania Australia",
    "Pacific": "Oceania Pacific islands",
    "Atlantic": "Atlantic islands",
    "Indian": "Indian Ocean islands",
}


def fetch(url: str, name: str) -> str:
    path = DATA / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    print(f"downloading {url}")
    text = requests.get(url, timeout=60).text
    DATA.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def size_class(out_routes: int) -> str:
    if out_routes > 300:
        return "hub"
    return "large" if out_routes > 60 else "regional"


def build_doc(row: dict, out_routes: int) -> str:
    """Everything a user might plausibly type, folded into one string.

    This single field feeds BOTH the full-text index and the embedding, so
    the two retrievers see the same evidence and only differ in *how* they
    match it — which is exactly what the demo is trying to show.
    """
    tz = (row["tz"] or "")
    region = REGION_BY_TZ.get(tz.split("/")[0], "")
    if out_routes > 300:
        size = "major international hub very large airport"
    elif out_routes > 80:
        size = "large international airport"
    elif out_routes > 15:
        size = "regional airport"
    else:
        size = "small airport limited service"
    alt = "high altitude mountain airport" if row["alt_ft"] > 6000 else ""
    parts = [
        row["name"], row["city"], row["country"],
        row["iata"] or "", row["icao"] or "",
        region, size, alt,
    ]
    return " ".join(p for p in parts if p).strip()


def parse_airports(text: str) -> list[dict]:
    out = []
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 12:
            continue
        try:
            out.append({
                "id": int(r[0]), "name": r[1], "city": r[2], "country": r[3],
                "iata": r[4] if len(r[4]) == 3 and r[4] != "\\N" else None,
                "icao": r[5] if len(r[5]) == 4 and r[5] != "\\N" else None,
                "lat": float(r[6]), "lon": float(r[7]),
                "alt_ft": int(float(r[8] or 0)),
                "tz": r[11] if r[11] != "\\N" else None,
            })
        except (ValueError, IndexError):
            continue
    return out


def parse_routes(text: str) -> list[tuple]:
    out = []
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 9 or len(r[2]) != 3 or len(r[4]) != 3:
            continue
        out.append((r[0], r[2], r[4], int(r[7] or 0), r[8][:64]))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 = all airports")
    ap.add_argument("--skip-routes", action="store_true")
    args = ap.parse_args()

    airports = parse_airports(fetch(AIRPORTS_URL, "airports.dat"))
    routes = parse_routes(fetch(ROUTES_URL, "routes.dat"))

    degree: dict[str, int] = {}
    for _, src, dst, *_ in routes:
        degree[src] = degree.get(src, 0) + 1
        degree[dst] = degree.get(dst, 0) + 1

    # Busiest first, so --limit gives you the airports people actually search.
    airports.sort(key=lambda a: -degree.get(a["iata"] or "", 0))
    if args.limit:
        airports = airports[: args.limit]
    print(f"{len(airports)} airports, {len(routes)} routes")

    docs = [build_doc(a, degree.get(a["iata"] or "", 0)) for a in airports]
    print("embedding...")
    vecs = embed(docs)

    rows = [
        (a["id"], a["name"], a["city"], a["country"], a["iata"], a["icao"],
         a["lat"], a["lon"], a["alt_ft"], a["tz"],
         size_class(degree.get(a["iata"] or "", 0)), doc, to_sql_vector(v))
        for a, doc, v in zip(airports, docs, vecs)
    ]

    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("SET SESSION tidb_enable_vectorized_expression = ON")
        for i in range(0, len(rows), 200):
            cur.executemany(
                "REPLACE INTO airports "
                "(id,name,city,country,iata,icao,lat,lon,alt_ft,tz,size_class,doc,doc_vec) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                rows[i : i + 200],
            )
            print(f"  airports {min(i+200, len(rows))}/{len(rows)}")

        if not args.skip_routes:
            keep = {a["iata"] for a in airports if a["iata"]}
            rt = [r for r in routes if r[1] in keep and r[2] in keep]
            cur.execute("TRUNCATE TABLE routes")
            for i in range(0, len(rt), 1000):
                cur.executemany(
                    "INSERT INTO routes (airline,src_iata,dst_iata,stops,equipment) "
                    "VALUES (%s,%s,%s,%s,%s)",
                    rt[i : i + 1000],
                )
            print(f"  routes {len(rt)}")
    conn.close()
    print("done. Vector index build runs in the background; check with:")
    print("  SELECT * FROM information_schema.tiflash_indexes;")


if __name__ == "__main__":
    main()
