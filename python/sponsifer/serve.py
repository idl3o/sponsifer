"""Serve the bundled web app, the OBS overlay and the workspace, on this machine only.

Bound to 127.0.0.1, so nothing on the network can reach it, and every request
must name 127.0.0.1 or localhost in its Host header, so a web page cannot reach
it by rebinding a hostname either. Serving from localhost also means the app's
calls to a local Ollama are same-machine calls.

The workspace file is the source of truth. The app reads and writes it through
`/api/workspace`; the overlay, loaded by OBS with storage of its own, reads the
same file. See `api.py` for the rules.
"""

from __future__ import annotations

import http.server
import webbrowser
from pathlib import Path

from . import api
from .brand import PRODUCT
from .obs import OBS_URL
from .runner import Runner

WEB = Path(__file__).parent / "web"


class _Server(http.server.ThreadingHTTPServer):
    """A threading server that carries what its handlers need."""

    ctx: api.Context
    web: Path
    api_only: bool


class _Handler(http.server.SimpleHTTPRequestHandler):
    server: _Server

    def __init__(self, request, client_address, server: _Server) -> None:  # noqa: ANN001 - stdlib signature
        super().__init__(request, client_address, server, directory=str(server.web))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - stdlib signature
        pass

    def end_headers(self) -> None:
        # The pages must always be revalidated: OBS's embedded browser keeps a
        # page it has loaded, and a stale overlay.html points at assets that
        # no longer exist after a rebuild. The assets themselves carry a hash
        # in their names and may be cached.
        if self.path.split("?", 1)[0].endswith((".html", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _host_ok(self) -> bool:
        if api.host_allowed(self.headers.get("Host"), self.server.ctx.port):
            return True
        self._send(api.Response(403, {"Content-Type": "text/plain"}, b"This server answers only to 127.0.0.1 and localhost."))
        return False

    def _send(self, response: api.Response) -> None:
        self.send_response(response.status)
        for name, value in response.headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        if self.command != "HEAD" and response.status != 304:
            self.wfile.write(response.body)

    def _api(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length > api.MAX_BODY:
            self.close_connection = True
            self._send(api.Response(413, {"Content-Type": "text/plain"}, b"Too large."))
            return
        body = self.rfile.read(length) if length else b""
        self._send(api.handle(self.command, self.path, self.headers, body, self.server.ctx))

    def _static(self) -> None:
        if self.server.api_only:
            self._send(api.Response(404, {"Content-Type": "text/plain"}, b"This server was started with --api-only."))
            return
        route, _, query = self.path.partition("?")
        if route in ("/overlay", "/overlay/"):
            self.path = "/overlay.html" + (f"?{query}" if query else "")
        if self.command == "HEAD":
            super().do_HEAD()
        else:
            super().do_GET()

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        if not self._host_ok():
            return
        if self.path.startswith("/api/"):
            self._api()
        else:
            self._static()

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib name
        self.do_GET()

    def do_PUT(self) -> None:  # noqa: N802 - stdlib name
        if self._host_ok():
            self._api()

    do_POST = do_DELETE = do_PATCH = do_PUT


def make_server(workspace: Path, port: int = 5180, api_only: bool = False,
                allowed_origins: frozenset[str] = frozenset(), web: Path = WEB, home: Path | None = None,
                obs_url: str = OBS_URL) -> _Server:
    """Bind 127.0.0.1. Port 0 picks a free port, which the context then records."""
    server = _Server(("127.0.0.1", port), _Handler)
    server.web, server.api_only = web, api_only
    runner = Runner(home or workspace.parent, obs_url)
    server.ctx = api.Context(workspace, server.server_address[1], allowed_origins, home=home, runner=runner)
    return server


def serve(workspace: Path, port: int = 5180, open_browser: bool = True, api_only: bool = False,
          allowed_origins: frozenset[str] = frozenset(), home: Path | None = None, obs_url: str = OBS_URL) -> None:
    """Serve until interrupted."""
    if not api_only and not (WEB / "index.html").exists():
        raise SystemExit(
            "The web app is not bundled in this install. From a checkout, run `npm run bundle` first, "
            "or use `npm run dev` with `npm run dev:api` for development."
        )
    with make_server(workspace, port, api_only, allowed_origins, home=home, obs_url=obs_url) as server:
        url = f"http://127.0.0.1:{server.ctx.port}/"
        what = f"{PRODUCT}'s workspace API" if api_only else PRODUCT
        print(f"{what} is running at {url}  (Ctrl+C to stop)")
        print(f"Your workspace is saved to {workspace}. Nothing is sent anywhere.")
        if open_browser and not api_only:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            # A logger still running closes its session in the log before the server goes.
            if server.ctx.runner is not None:
                server.ctx.runner.stop()
