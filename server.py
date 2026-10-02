#!/usr/bin/env python3
"""
Local backend for Jev Pipeline.

Why a backend at all: the browser cannot call TypeSafe's Jev API directly
(the API blocks browser origins via CORS) and must never see your secret key.
So this tiny server does two jobs:

  1. serves the static frontend in ./web
  2. exposes POST /api/decide, which attaches your JEV_API_KEY server-side and
     forwards the request to Jev, then returns Jev's answer to the page.

The browser only ever talks to http://127.0.0.1 (same origin), so there is no
CORS problem, and the key stays on your machine. Stdlib only, no pip installs.

Run:
    cp .env.example .env     # then paste your key into .env
    python3 server.py
    # open http://127.0.0.1:8000
"""
import json
import os
import mimetypes
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JEV_URL = "https://api.typesafe.ai/v1/systemone"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def load_dotenv(path=".env"):
    """Minimal .env loader so there are no dependencies. Real env wins."""
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()
KEY = os.environ.get("JEV_API_KEY", "").strip()
MODEL = os.environ.get("JEV_MODEL", "jev-latest").strip()
PORT = int(os.environ.get("PORT", "8000"))


def call_jev(payload):
    """Forward a decision request to Jev with the server-side key.
    Returns (http_status, parsed_json)."""
    body = json.dumps({
        "state": payload.get("state", ""),
        "model": payload.get("model") or MODEL,
        "questions": payload.get("questions", {}),
    }).encode()
    req = urllib.request.Request(JEV_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        # Pass Jev's own error through so the UI can show it.
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"error": "Jev returned HTTP %s" % e.code}
    except Exception as e:
        return 502, {"error": "Could not reach Jev: %s" % e}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/health":
            return self._send(200, {"key_set": bool(KEY), "model": MODEL})
        # static files out of ./web, with path-traversal protection
        rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            return self._send(200, f.read(), ctype)

    def do_POST(self):
        if self.path != "/api/decide":
            return self._send(404, {"error": "not found"})
        if not KEY:
            return self._send(503, {"error": "JEV_API_KEY is not set. "
                                    "Copy .env.example to .env, paste your key, and restart."})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "body must be JSON"})
        status, resp = call_jev(payload)
        return self._send(status, resp)

    def log_message(self, *a):  # keep the console quiet
        pass


if __name__ == "__main__":
    state = "key loaded" if KEY else "NO KEY SET (set JEV_API_KEY in .env)"
    print("Jev Pipeline running at http://127.0.0.1:%d   [%s, model=%s]" % (PORT, state, MODEL))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
