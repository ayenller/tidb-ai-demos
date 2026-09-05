#!/usr/bin/env python3
"""Guard the claim this demo makes about itself.

The README says "the SQL you see on the page is the SQL that runs". That is
only true if three copies stay in step:

    sql/02_queries.sql      the reference, meant to be read
    app/search.py           what the backend actually executes
    web/js/app.js           what the SQL drawer displays

and if the tuning constants agree between the Python backend and the
JavaScript engine that stands in for it offline. They drifted once already —
the fusion gate was 0.30 in JavaScript, declared as a session variable in the
.sql file, and hardcoded as a different literal in the query underneath it.

    python3 scripts/check_consistency.py

Exits non-zero on any mismatch. SQL parsing needs `sqlglot`; without it that
part is skipped and the constant checks still run.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILS: list[str] = []


def fail(msg: str) -> None:
    FAILS.append(msg)
    print(f"  FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


# --------------------------------------------------------------------------
def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def num(pattern: str, text: str, what: str) -> float | None:
    m = re.search(pattern, text, re.M)
    if not m:
        fail(f"could not find {what}")
        return None
    return float(m.group(1))


# --------------------------------------------------------------------------
def check_constants() -> None:
    print("tuning constants (engine.js vs app/search.py vs the SQL):")
    js = read("web/js/engine.js")
    py = read("app/search.py")
    sql = read("sql/02_queries.sql")
    drawer = read("web/js/app.js")

    pairs = [
        ("RRF k",
         num(r"const K_RRF = (\d+)", js, "K_RRF in engine.js"),
         num(r"RRF_K = (\d+)", py, "RRF_K in search.py"),
         num(r"SET @k\s*=\s*([\d.]+)", sql, "@k in 02_queries.sql")),
        ("candidate pool",
         num(r"const POOL = (\d+)", js, "POOL in engine.js"),
         num(r"^POOL = (\d+)", py, "POOL in search.py"),
         None),
        ("vector weight",
         num(r"vector: ([\d.]+) \}", js, "vector weight in engine.js"),
         num(r'"vector": ([\d.]+)\}', py, "vector weight in search.py"),
         num(r"UNION ALL\s+SELECT id, rnk, ([\d.]+) AS w FROM vec", sql,
             "vector weight in 02_queries.sql")),
        ("vector gate",
         num(r"vector: ([\d.]+),\s*//", js, "GATE.vector in engine.js"),
         num(r"GATE_VECTOR = ([\d.]+)", py, "GATE_VECTOR in search.py"),
         num(r"SET @gv\s*=\s*([\d.]+)", sql, "@gv in 02_queries.sql")),
        ("full-text gate (absolute)",
         num(r"fulltextAbs: ([\d.]+)", js, "GATE.fulltextAbs in engine.js"),
         num(r"GATE_FTS_ABS = ([\d.]+)", py, "GATE_FTS_ABS in search.py"),
         num(r"SET @gfa\s*=\s*([\d.]+)", sql, "@gfa in 02_queries.sql")),
        ("full-text gate (relative)",
         num(r"fulltextRel: ([\d.]+)", js, "GATE.fulltextRel in engine.js"),
         num(r"GATE_FTS_REL = ([\d.]+)", py, "GATE_FTS_REL in search.py"),
         num(r"SET @gfr\s*=\s*([\d.]+)", sql, "@gfr in 02_queries.sql")),
    ]
    for name, a, b, c in pairs:
        vals = [v for v in (a, b, c) if v is not None]
        if len(vals) < 2:
            continue
        if len(set(vals)) == 1:
            ok(f"{name} = {vals[0]:g}")
        else:
            fail(f"{name} disagrees: engine.js={a} search.py={b} sql={c}")

    # row limits
    js_lim = dict(re.findall(r"(\w+): (\d+)",
                             re.search(r"const LIMITS = \{([^}]*)\}", js).group(1)))
    py_lim = dict(re.findall(r'"(\w+)": (\d+)',
                             re.search(r"LIMITS = \{([^}]*)\}", py).group(1)))
    if js_lim == py_lim:
        ok(f"row limits {js_lim}")
    else:
        fail(f"row limits disagree: engine.js={js_lim} search.py={py_lim}")

    for name, want in (("vector", js_lim.get("vector")), ("hybrid", js_lim.get("hybrid"))):
        block = re.search(rf"\n    {name}: \(q\) => `(.*?)`,\n", drawer, re.S)
        if not block:
            fail(f"no {name} SQL in the drawer")
            continue
        limits = re.findall(r"LIMIT (\d+);", block.group(1))
        if limits and limits[-1] == want:
            ok(f"drawer {name} SQL ends in LIMIT {want}")
        else:
            fail(f"drawer {name} SQL ends in LIMIT {limits[-1:]}, expected {want}")


# --------------------------------------------------------------------------
def check_size_words() -> None:
    print("size-class wording (data.js vs scripts/load_data.py):")
    js = dict(re.findall(r'(hub|large|regional): "([^"]+)"', read("web/js/data.js")))
    py = dict(re.findall(r'"(hub|large|regional)": "([^"]+)"', read("scripts/load_data.py")))
    if not js or not py:
        fail("could not read the size-class wording from both sides")
    elif js == py:
        ok("the words that go into `doc` match on both sides")
    else:
        fail(f"size wording differs:\n        data.js={js}\n        load_data.py={py}")


# --------------------------------------------------------------------------
def check_sql_parses() -> None:
    print("SQL parses (needs sqlglot):")
    try:
        import sqlglot
        from sqlglot.errors import ParseError
    except ImportError:
        print("  skip  sqlglot not installed (pip install sqlglot)")
        return

    def parse(label: str, text: str) -> None:
        text = text.replace(":q_vec", "'[0.1]'").replace(":q", "'heathrow'")
        try:
            sqlglot.parse(text, read="mysql", error_level=sqlglot.ErrorLevel.RAISE)
            ok(label)
        except ParseError as exc:
            fail(f"{label}: {str(exc).splitlines()[0]}")

    # 01_schema.sql is skipped: AUTO_RANDOM, VECTOR(n), FULLTEXT ... WITH PARSER
    # and SET TIFLASH REPLICA are TiDB extensions no general parser knows.
    parse("sql/02_queries.sql", read("sql/02_queries.sql"))

    py = read("app/search.py")
    for i, m in enumerate(re.finditer(r'sql = f"""(.*?)"""', py, re.S), 1):
        q = m.group(1).replace("{COLS}", "id, name, city")
        q = re.sub(r"%\((?:q|lk|v)\)s", "'x'", q)
        q = re.sub(r"%\(\w+\)s", "1", q).replace("%%", "%")
        parse(f"app/search.py query {i}", q)

    js = read("web/js/app.js")
    for name in ("like", "fulltext", "vector", "hybrid"):
        m = re.search(rf"\n    {name}: \(q\) => `(.*?)`,\n", js, re.S)
        if not m:
            fail(f"no {name} SQL in the drawer")
            continue
        parse(f"web/js/app.js [{name}]", m.group(1).replace("${q}", "heathrow"))


# --------------------------------------------------------------------------
if __name__ == "__main__":
    check_constants()
    check_size_words()
    check_sql_parses()
    print()
    if FAILS:
        print(f"{len(FAILS)} problem(s).")
        sys.exit(1)
    print("Everything agrees.")
