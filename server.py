"""Local server for the GIST library room-availability map.

Serves ./static and passes /lib/<path> straight through to the library API
(https://library.gist.ac.kr:8443). The page itself (static/library.js) does all the API work, so it
also runs from any static host such as GitHub Pages; on localhost it uses this pass-through, which
keeps working even if the library ever stops allowing cross-origin calls.
"""
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
API = "https://library.gist.ac.kr:8443"


def load_env():
    env = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "static"), **kwargs)

    def end_headers(self):
        # Always revalidate, so edits to static files show up without a hard refresh.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        if not self.path.startswith("/lib/"):
            return self.send_error(404)
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        headers = {"Content-Type": "application/json"}
        if self.headers.get("Authorization"):
            headers["Authorization"] = self.headers["Authorization"]
        req = urllib.request.Request(API + self.path[len("/lib"):], body, headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read()
        except OSError as e:
            status, data = 502, str(e).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(ENV.get("PORT", 8000))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://localhost:{port}")
    server.serve_forever()
