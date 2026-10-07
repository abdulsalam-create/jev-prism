#!/usr/bin/env python3
# Serves ./web and proxies POST /api/decide to Jev with the key from .env,
# so the key stays server-side and the browser avoids the CORS block. Stdlib only.
import json
import os
import mimetypes
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JEV_URL = "https://api.typesafe.ai/v1/systemone"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def load_dotenv(path=".env"):
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

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    state = "key loaded" if KEY else "NO KEY SET (set JEV_API_KEY in .env)"
    print("Jev Pipeline running at http://127.0.0.1:%d   [%s, model=%s]" % (PORT, state, MODEL))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
