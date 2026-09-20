"""The local server's JSON interface to the workspace file.

The app, the OBS overlay and the CLI agree through one file, because OBS's
embedded browser keeps its own storage apart from the creator's browser. This
module answers the requests; `serve.py` owns the socket. It never touches the
network itself, so every rule below is tested without one.

    GET /api/info        what is being served, and where the file lives
    GET /api/workspace   the file's bytes, with its revision as the ETag
    PUT /api/workspace   replace it, if it is still at the revision the app read
    GET /api/onair/<deal>    what the on-air log says for a deal
    GET /api/logger          whether the on-air logger is running, and for which deal
    POST /api/logger/start   start it for a won deal; the body may carry OBS's password
    POST /api/logger/stop    stop it
    POST /api/obs/setup      put a won deal's placements into OBS; the body may carry OBS's password

Two guards, because a page on any website can send requests to 127.0.0.1:

- The Host header must name this server. A DNS-rebinding page arrives under
  its own hostname and is refused before it can read anything.
- A write must come from this server's own origin, as JSON. A cross-site JSON
  PUT is preflighted, and the server answers no preflight and sends no CORS
  headers, so a foreign page can neither write nor read the answer.

Starting and stopping the logger are writes, and pass the same guard: a foreign
page must not be able to switch a creator's evidence off.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from . import __version__, obs_setup, onair, report, workspace
from .brand import PRODUCT
from .runner import Busy, ObsRefused, Runner

#: The largest workspace accepted. The board's image is capped near 400 KB.
MAX_BODY = 4 * 1024 * 1024
#: Top-level fields a workspace must carry, and the JSON type of each.
REQUIRED = {"profile": dict, "terms": dict, "prospects": list, "deals": list, "board": dict}


@dataclass(frozen=True)
class Response:
    """What to send back: status, headers and body."""

    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""


@dataclass(frozen=True)
class Context:
    """What the server was started with, and the lock every file access takes."""

    workspace: Path
    port: int
    allowed_origins: frozenset[str] = frozenset()
    lock: threading.Lock = field(default_factory=threading.Lock, compare=False)
    #: Where the on-air logs and the signed reports live. The workspace's folder unless told otherwise.
    home: Path | None = None
    #: The on-air logger this server can run. None when it was built without one.
    runner: Runner | None = field(default=None, compare=False)

    def home_dir(self) -> Path:
        return self.home or self.workspace.parent

    def own_origins(self) -> frozenset[str]:
        """Origins a write may come from: this server's two names, and any allowed for development."""
        return frozenset({f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"}) | self.allowed_origins


def host_allowed(host: str | None, port: int) -> bool:
    """True when the Host header names this server, which a DNS-rebinding page cannot fake."""
    return host in {f"127.0.0.1:{port}", f"localhost:{port}"}


def _json(status: int, data: Any, etag: str | None = None) -> Response:
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if etag:
        headers["ETag"] = etag
    return Response(status, headers, json.dumps(data).encode("utf-8"))


def _etag(rev: str) -> str:
    return f'"{rev}"'


def _unquote(tag: str | None) -> str | None:
    if tag is None:
        return None
    tag = tag.strip()
    return tag[2:].strip('"') if tag.startswith("W/") else tag.strip('"')


def handle(method: str, path: str, headers: Mapping[str, str], body: bytes, ctx: Context) -> Response:
    """Answer one request under /api. Headers are matched case-insensitively."""
    h = {k.lower(): v for k, v in headers.items()}
    if not host_allowed(h.get("host"), ctx.port):
        return _json(403, {"error": "this server answers only to 127.0.0.1 and localhost"})
    route = path.split("?", 1)[0]
    if route == "/api/info" and method == "GET":
        return _json(200, {"product": PRODUCT, "version": __version__, "format": workspace.SUPPORTED_VERSION,
                           "workspacePath": str(ctx.workspace)})
    if route == "/api/workspace" and method in ("GET", "HEAD"):
        return _read(h, ctx)
    if route == "/api/workspace" and method == "PUT":
        return _write(h, body, ctx)
    if route.startswith("/api/onair/") and method == "GET":
        return _onair(route[len("/api/onair/"):], ctx)
    if route == "/api/logger" and method == "GET" and ctx.runner is not None:
        return _json(200, ctx.runner.status().to_json())
    if route in ("/api/logger/start", "/api/logger/stop") and method == "POST" and ctx.runner is not None:
        return _logger(route.rsplit("/", 1)[1], h, body, ctx, ctx.runner)
    if route == "/api/obs/setup" and method == "POST" and ctx.runner is not None:
        return _obs_setup(h, body, ctx, ctx.runner)
    if route in ("/api/info", "/api/workspace"):
        return _json(405, {"error": f"{method} is not allowed here"})
    return _json(404, {"error": "no such endpoint"})


#: A deal id as the app generates them. Anything else could be a path.
_DEAL_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def _onair(deal_id: str, ctx: Context) -> Response:
    """What the on-air log says for a deal, and which signed reports exist. Read-only."""
    if not _DEAL_ID.match(deal_id):
        return _json(400, {"error": "not a deal id"})
    home = ctx.home_dir()
    lines = onair.read_log(onair.log_path(home, deal_id))
    if not lines:
        return _json(404, {"missing": True})
    folder = report.reports_dir(home)
    names = sorted(p.name[: -len(".report.json")] for p in folder.glob(f"{deal_id}-*.report.json")) if folder.exists() else []
    return _json(200, {**onair.delivery(lines).to_json(), "reports": names})


def _not_loggable(deal_id: Any, ctx: Context) -> Response | None:
    """Why this deal cannot be logged, or None. The same refusals as `sponsifer log`."""
    if not isinstance(deal_id, str) or not _DEAL_ID.match(deal_id):
        return _json(400, {"error": "not a deal id"})
    with ctx.lock:
        try:
            data = workspace.load(ctx.workspace)
        except FileNotFoundError:
            return _json(404, {"error": "there is no workspace file yet"})
        except ValueError as error:
            return _json(422, {"error": str(error)})
    deal = workspace.find_deal(data, deal_id)
    if deal is None:
        # The app saves a moment after an edit, so a deal recorded seconds ago may not have reached the file.
        return _json(404, {"error": f"no deal {deal_id} in the workspace file yet; if you have just recorded it, "
                                    "it is still being saved, so try again in a moment"})
    if deal.get("outcome") != "won":
        return _json(409, {"error": f"{deal_id} is not a won deal, so there is nothing to deliver"})
    return None


def _asked(body: bytes, ctx: Context) -> tuple[str, str | None] | Response:
    """The won deal a request names, and OBS's password if it sent one; or why not."""
    try:
        asked = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return _json(400, {"error": "the body is not valid JSON"})
    if not isinstance(asked, dict):
        return _json(400, {"error": "send the deal as a JSON object"})
    deal_id, password = asked.get("deal"), asked.get("password")
    if password is not None and not isinstance(password, str):
        return _json(400, {"error": "the password must be text"})
    return _not_loggable(deal_id, ctx) or (deal_id, password or None)


def _obs_setup(h: Mapping[str, str], body: bytes, ctx: Context, runner: Runner) -> Response:
    """
    Put a won deal's placements into OBS. A write, behind the write guard: a
    foreign page must not be able to change what a creator's stream shows. The
    address OBS is given is built from this server's own port, never from the request.
    """
    refused = _refusal(h, body, ctx)
    if refused:
        return refused
    asked = _asked(body, ctx)
    if isinstance(asked, Response):
        return asked
    deal_id, password = asked
    try:
        result = runner.with_obs(password, lambda obs: obs_setup.setup(obs, ctx.port, deal_id))
    except Busy as busy:
        return _json(409, {"error": f"the logger is running for {busy.deal}, and its log has already written down what "
                                    "each source is showing; stop it before changing them"})
    except ObsRefused as no:
        return _json(502, {"error": str(no), "needsPassword": no.needs_password})
    return _json(200, result.to_json())


def _logger(action: str, h: Mapping[str, str], body: bytes, ctx: Context, runner: Runner) -> Response:
    """Start or stop the on-air logger. The password, if any, goes to OBS and nowhere else."""
    refused = _refusal(h, body, ctx)
    if refused:
        return refused
    if action == "stop":
        return _json(200, runner.stop().to_json())
    asked = _asked(body, ctx)
    if isinstance(asked, Response):
        return asked
    deal_id, password = asked
    try:
        status = runner.start(deal_id, password)
    except Busy as busy:
        if busy.deal == deal_id:
            return _json(200, runner.status().to_json())
        return _json(409, {"error": f"the logger is already running for {busy.deal}; stop it first", "deal": busy.deal})
    # 502: this server is fine, and OBS, which it was asked to reach, said no.
    return _json(200 if status.running else 502, status.to_json())


def _read(h: Mapping[str, str], ctx: Context) -> Response:
    """The file's bytes as they are on disk. The app's parser upgrades older formats."""
    with ctx.lock:
        try:
            raw = ctx.workspace.read_bytes()
        except FileNotFoundError:
            return _json(404, {"missing": True})
    rev = workspace.revision(raw)
    etag = _etag(rev)
    if _unquote(h.get("if-none-match")) == rev:
        return Response(304, {"ETag": etag, "Cache-Control": "no-store"})
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        return _json(422, {"error": f"the workspace file is not valid JSON ({error})"}, etag)
    if not isinstance(data, dict):
        return _json(422, {"error": "the workspace file does not hold a workspace"}, etag)
    return Response(200, {"Content-Type": "application/json", "Cache-Control": "no-store", "ETag": etag,
                          "X-Content-Type-Options": "nosniff"}, raw)


def _refusal(h: Mapping[str, str], body: bytes, ctx: Context) -> Response | None:
    """Why a write is refused before the file is looked at, or None."""
    if h.get("origin") not in ctx.own_origins():
        return _json(403, {"error": "writes are accepted only from this app"})
    if not h.get("content-type", "").startswith("application/json"):
        return _json(415, {"error": "send the workspace as application/json"})
    if len(body) > MAX_BODY:
        return _json(413, {"error": f"the workspace is over {MAX_BODY // (1024 * 1024)} MB"})
    return None


def shape_error(data: Any) -> str | None:
    """
    Why this is not a workspace the app would have written, or None.

    Only the outline is checked. The app's parser checks every field, and it is
    the one validator: a second one here would drift from it.
    """
    if not isinstance(data, dict):
        return "the body is not a workspace"
    if data.get("version") != workspace.SUPPORTED_VERSION:
        return f"expected workspace format {workspace.SUPPORTED_VERSION}, got {data.get('version')!r}"
    for key, kind in REQUIRED.items():
        if not isinstance(data.get(key), kind):
            return f"{key} is missing or the wrong shape"
    return None


def _precondition(h: Mapping[str, str]) -> str | None:
    """The revision the write expects: If-Match names one, If-None-Match: * means no file yet."""
    if h.get("if-match"):
        return _unquote(h["if-match"])
    if h.get("if-none-match", "").strip() == "*":
        return workspace.ABSENT
    return None


def _write(h: Mapping[str, str], body: bytes, ctx: Context) -> Response:
    refused = _refusal(h, body, ctx)
    if refused:
        return refused
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return _json(400, {"error": "the body is not valid JSON"})
    problem = shape_error(data)
    if problem:
        return _json(422, {"error": problem})
    expected = _precondition(h)
    if expected is None:
        return _json(428, {"error": "send If-Match with the revision you read, or If-None-Match: * to create"})
    with ctx.lock:
        return _replace(ctx, data, expected, h.get("x-replace-unreadable") == "1")


def _replace(ctx: Context, data: dict[str, Any], expected: str, set_aside: bool) -> Response:
    """Compare and swap. Called with the lock held."""
    current = workspace.current_revision(ctx.workspace)
    if current != expected:
        return _conflict(ctx, current)
    if set_aside and current != workspace.ABSENT:
        # An unreadable file is copied aside, never dropped.
        shutil.copyfile(ctx.workspace, ctx.workspace.with_name(f"workspace.unreadable-{current[:12]}.json"))
    try:
        rev = workspace.save(ctx.workspace, data, expected=expected)
    except workspace.Changed:
        return _conflict(ctx, workspace.current_revision(ctx.workspace))
    return _json(200, {"revision": rev}, _etag(rev))


def _conflict(ctx: Context, current: str) -> Response:
    if current == workspace.ABSENT:
        return _json(409, {"error": "the workspace file is gone", "missing": True})
    return _json(409, {"error": "the workspace changed on disk since it was read"}, _etag(current))
