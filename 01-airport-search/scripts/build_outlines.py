#!/usr/bin/env python3
"""Rebuild web/js/world.js — the country outlines the globe draws.

Downloads Natural Earth 1:110m admin-0 (public domain), simplifies it with
Douglas-Peucker, drops the tiny islands, and re-densifies the long segments
so each ring hugs the sphere instead of cutting a chord through it.

    python3 scripts/build_outlines.py

Nothing at runtime depends on this: the output is committed, so the page
works with no network at all. Re-run it only to change the detail level.
"""
import json
import math
import urllib.request
from pathlib import Path

SRC = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector"
       "/master/geojson/ne_110m_admin_0_countries.geojson")
OUT = Path(__file__).resolve().parent.parent / "web" / "js" / "world.js"
CACHE = Path(__file__).resolve().parent.parent / "data" / "ne_110m_countries.geojson"

EPS = 0.2        # Douglas-Peucker tolerance, degrees
MIN_SPAN = 0.7   # drop rings whose bounding box is smaller than this
MAX_SEG = 3.5    # re-densify anything longer than this, degrees


def rdp(pts: list, eps: float) -> list:
    """Iterative Douglas-Peucker (recursion blows up on Antarctica)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        x1, y1 = pts[a]
        x2, y2 = pts[b]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = (abs(dy * x - dx * y + x2 * y1 - y2 * x1) / den if den
                 else math.hypot(x - x1, y - y1))
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def rings(geom: dict) -> list:
    t, c = geom["type"], geom["coordinates"]
    if t == "Polygon":
        return [c[0]]                      # exterior only; holes are lakes
    if t == "MultiPolygon":
        return [p[0] for p in c]
    return []


def main() -> None:
    if CACHE.exists():
        raw = json.loads(CACHE.read_text(encoding="utf-8"))
    else:
        print(f"downloading {SRC}")
        with urllib.request.urlopen(SRC, timeout=120) as r:   # stdlib only:
            raw = json.load(r)                                # no pip install
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(raw), encoding="utf-8")

    out = []
    for feat in raw["features"]:
        for ring in rings(feat["geometry"]):
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            if max(max(xs) - min(xs), max(ys) - min(ys)) < MIN_SPAN:
                continue
            pts = rdp([(p[0], p[1]) for p in ring], EPS)
            if len(pts) < 4:
                continue
            dense = [pts[0]]
            for x2, y2 in pts[1:]:
                x1, y1 = dense[-1]
                n = int(max(abs(x2 - x1), abs(y2 - y1)) / MAX_SEG)
                for k in range(1, n + 1):
                    t = k / (n + 1)
                    dense.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
                dense.append((x2, y2))
            flat = []
            for x, y in dense:
                flat += [round(x, 2), round(y, 2)]
            out.append(flat)

    body = ",\n".join("[" + ",".join(f"{v:g}" for v in r) + "]" for r in out)
    js = (f"/* Country outlines — Natural Earth 1:110m admin-0, simplified offline\n"
          f" * (Douglas-Peucker eps={EPS}deg; islands under {MIN_SPAN}deg of span dropped;\n"
          f" * long segments re-densified so the ring hugs the sphere instead of\n"
          f" * cutting a chord through it). Natural Earth is public domain.\n"
          f" * Regenerate with scripts/build_outlines.py.\n"
          f" * Each entry is one closed ring: flat [lon,lat,lon,lat,...]. */\n"
          f"const WORLD_OUTLINES = [\n{body}\n];\n")
    OUT.write_text(js, encoding="utf-8")
    pts_total = sum(len(r) // 2 for r in out)
    print(f"{OUT.relative_to(OUT.parents[3])}: {len(out)} rings, "
          f"{pts_total} points, {len(js) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
