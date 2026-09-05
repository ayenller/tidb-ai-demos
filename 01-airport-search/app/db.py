"""Thin TiDB connection helper. TiDB speaks the MySQL protocol, so any
MySQL driver works — nothing here is TiDB-specific except the TLS default."""
import os
import ssl
from contextlib import contextmanager

import pymysql
from dotenv import load_dotenv

load_dotenv()


def _ssl_args() -> dict:
    if os.getenv("TIDB_SSL_VERIFY", "true").lower() != "true":
        return {}
    ctx = ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return {"ssl": ctx}


def connect(db: str | None = None) -> pymysql.connections.Connection:
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


@contextmanager
def cursor(db: str | None = None):
    conn = connect(db)
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()
