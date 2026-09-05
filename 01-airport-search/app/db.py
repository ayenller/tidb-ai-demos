"""Thin TiDB connection helper. TiDB speaks the MySQL protocol, so any MySQL
driver works — nothing here is TiDB-specific except the TLS default.

The connection is kept per thread and reused. That matters more than it
looks: FastAPI runs sync endpoints in a threadpool, one search fires four
queries, and opening a fresh TLS connection to TiDB Cloud for each of them
would add a handshake to every number this demo puts on screen. Comparing
retrieval strategies is the whole point, so the timings have to be the
query and nothing else.
"""
import os
import ssl
import threading
from contextlib import contextmanager

import pymysql
from dotenv import load_dotenv

load_dotenv()

_local = threading.local()
DEAD = (pymysql.err.OperationalError, pymysql.err.InterfaceError)


def _ssl_args() -> dict:
    if os.getenv("TIDB_SSL_VERIFY", "true").lower() != "true":
        return {}
    ctx = ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return {"ssl": ctx}


def connect(db: str | None = None) -> pymysql.connections.Connection:
    """A brand new connection. Used by the loader; the API reuses one."""
    return pymysql.connect(
        host=os.environ["TIDB_HOST"],
        port=int(os.getenv("TIDB_PORT", "4000")),
        user=os.environ["TIDB_USER"],
        password=os.environ.get("TIDB_PASSWORD", ""),
        database=db if db is not None else os.getenv("TIDB_DB", "airport_search"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
        **_ssl_args(),
    )


def _conn() -> pymysql.connections.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _local.conn = connect()
    return conn


def _drop() -> None:
    conn = getattr(_local, "conn", None)
    _local.conn = None
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def query(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query on the thread's connection.

    A pooled connection can be closed under you — idle timeout, a rolling
    restart on the TiDB side. Rather than paying for a ping before every
    query, find out the cheap way and reconnect once.
    """
    for last_attempt in (False, True):
        try:
            with _conn().cursor() as cur:
                cur.execute(sql, params or {})
                return list(cur.fetchall())
        except DEAD:
            _drop()
            if last_attempt:
                raise
    return []


@contextmanager
def cursor():
    """Escape hatch for anything `query` does not cover."""
    with _conn().cursor() as cur:
        yield cur
