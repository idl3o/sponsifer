"""Ask the running app's server to do something, as the app itself would.

`sponsifer setup` goes through the server rather than to OBS directly, so it
keeps the server's rules without copying them: OBS is given the server's own
address, never one the command line names; nothing is changed while a logger
runs, here or in a terminal; the password answers OBS once and is kept
nowhere. It also needs the server to be running, which is right: the sources
it makes load their overlays from that server, and would draw nothing without it.

The server checks a write's Origin against itself, to keep foreign web pages
out. A command on this machine is not a web page, and sends the server's own.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable


class NoServer(RuntimeError):
    """Nothing answered at the port."""


@dataclass(frozen=True, slots=True)
class Reply:
    status: int
    body: dict[str, Any] = field(default_factory=dict)

    @property
    def error(self) -> str:
        error = self.body.get("error")
        return error if isinstance(error, str) else f"the server answered {self.status}"


def post(port: int, path: str, payload: dict[str, Any], timeout: float = 30.0) -> Reply:
    """POST JSON to the server on this machine at `port`, as its own page would."""
    origin = f"http://127.0.0.1:{port}"
    request = urllib.request.Request(origin + path, data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Origin": origin})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never through a proxy
    try:
        with opener.open(request, timeout=timeout) as response:
            return Reply(response.status, _body(response.read()))
    except urllib.error.HTTPError as error:
        with error:
            return Reply(error.code, _body(error.read()))
    except (urllib.error.URLError, ConnectionError) as error:
        raise NoServer(f"nothing is answering at {origin}") from error


def _body(raw: bytes) -> dict[str, Any]:
    try:
        body = json.loads(raw)
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def setup(port: int, deal_id: str, password: Callable[[], str]) -> Reply:
    """Put a deal into OBS through the server. `password` is called only if OBS asks for one."""
    reply = post(port, "/api/obs/setup", {"deal": deal_id})
    if reply.status == 502 and reply.body.get("needsPassword") is True:
        reply = post(port, "/api/obs/setup", {"deal": deal_id, "password": password()})
    return reply


def setup_lines(result: dict[str, Any]) -> list[str]:
    """Exactly what was done to the creator's OBS, as `setupSentence` in src/domain/obsSetup.ts says it."""
    scene = result.get("scene", "")
    words = {
        "create": f'made, in the scene "{scene}", hidden until you show it',
        "keep": "already right",
        "blocked": "left alone: OBS has something else by this name that is not a browser source",
    }
    out = []
    for step in result.get("steps", []):
        action, was = step.get("action"), step.get("was")
        said = (f"pointed at {result.get('deal')}" + (f" (it was showing {was})" if was else "")
                if action == "repoint" else words.get(action, str(action)))
        out.append(f"  {step.get('source')}: {said}")
    return out or ["  Nothing needed doing."]
