#!/usr/bin/env python3
"""Static dev server for web/ that never caches — so a browser refresh
actually shows the edit you just made.

    python3 scripts/dev_server.py 8137
"""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):        # quiet
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    print(f"http://localhost:{port}  (serving {WEB})")
    HTTPServer(("127.0.0.1", port), partial(NoCache, directory=str(WEB))).serve_forever()
