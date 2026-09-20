"""Talking to OBS over its built-in WebSocket, and deciding what was on air.

The protocol layer and the on-air state machine, shared by the probe that
tested whether OBS reports activity reliably and by the logger that bills
against it. Everything here is transport-agnostic and free of I/O beyond the
socket it is handed, so both can be tested without OBS.

On air means the stream is live and the source is in the program feed. Times
are wall-clock UTC, never OBS's own stream clock, which is inflated under
Enhanced Broadcasting.
"""

from __future__ import annotations

import base64
import hashlib
import itertools
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

# EventSubscription bits. The two input-state events are high-volume and are
# NOT included in "All": a client that asks for All hears nothing about them.
SCENES, OUTPUTS, SCENE_ITEMS, UI = 1 << 2, 1 << 6, 1 << 7, 1 << 10
INPUT_ACTIVE, INPUT_SHOW = 1 << 17, 1 << 18
SUBSCRIPTIONS = SCENES | OUTPUTS | SCENE_ITEMS | UI | INPUT_ACTIVE | INPUT_SHOW

HELLO, IDENTIFY, IDENTIFIED, EVENT, REQUEST, RESPONSE = 0, 1, 2, 5, 6, 7

#: Where OBS's WebSocket server listens unless the creator moved it.
OBS_URL = "ws://127.0.0.1:4455"


def auth_string(password: str, salt: str, challenge: str) -> str:
    """obs-websocket 5 authentication: base64(sha256(base64(sha256(password + salt)) + challenge))."""
    secret = base64.b64encode(hashlib.sha256((password + salt).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((secret + challenge).encode()).digest()).decode()


def utc_now() -> str:
    """Wall-clock UTC to the millisecond."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass
class OnAir:
    """Whether the source is on air, from events, checked against polls. Pure: the caller supplies times."""

    stream_live: bool = False
    source_active: bool = False
    since: str | None = None
    intervals: list[tuple[str, str]] = field(default_factory=list)
    disagreements: int = 0

    @property
    def on_air(self) -> bool:
        return self.stream_live and self.source_active

    def _set(self, stream_live: bool, source_active: bool, at: str) -> str | None:
        """Apply a new state; return 'start' or 'end' when on-air status changes."""
        was = self.on_air
        self.stream_live, self.source_active = stream_live, source_active
        if self.on_air and not was:
            self.since = at
            return "start"
        if was and not self.on_air and self.since is not None:
            self.intervals.append((self.since, at))
            self.since = None
            return "end"
        return None

    def stream(self, live: bool, at: str) -> str | None:
        """The stream started or stopped."""
        return self._set(live, self.source_active, at)

    def source(self, active: bool, at: str) -> str | None:
        """The source entered or left the program feed, by event."""
        return self._set(self.stream_live, active, at)

    def poll(self, stream_live: bool, source_active: bool, at: str) -> tuple[bool, str | None]:
        """Reconcile with a poll. The poll wins. Returns whether it disagreed, and any transition."""
        disagreed = (stream_live, source_active) != (self.stream_live, self.source_active)
        self.disagreements += disagreed
        return disagreed, self._set(stream_live, source_active, at)


class Obs:
    """A minimal obs-websocket 5 client over any object with send(str) and recv(timeout) -> str."""

    def __init__(self, socket: Any, on_event: Callable[[dict], None]):
        self._socket, self._on_event, self._ids = socket, on_event, itertools.count(1)

    def identify(self, password: str | None) -> dict:
        """Answer Hello, subscribe to the events that matter, and wait for Identified."""
        hello = json.loads(self._socket.recv())
        if hello.get("op") != HELLO:
            raise RuntimeError(f"expected Hello, got {hello}")
        d: dict[str, Any] = {"rpcVersion": 1, "eventSubscriptions": SUBSCRIPTIONS}
        auth = hello["d"].get("authentication")
        if auth:
            if password is None:
                raise RuntimeError("OBS requires a password")
            d["authentication"] = auth_string(password, auth["salt"], auth["challenge"])
        self._socket.send(json.dumps({"op": IDENTIFY, "d": d}))
        identified = json.loads(self._socket.recv())
        if identified.get("op") != IDENTIFIED:
            raise RuntimeError(f"not identified: {identified}")
        return hello["d"]

    def request(self, request_type: str, data: dict | None = None) -> dict:
        """Send a request and return its response data, handing any events that arrive first to on_event."""
        request_id = str(next(self._ids))
        body = {"requestType": request_type, "requestId": request_id, **({"requestData": data} if data else {})}
        self._socket.send(json.dumps({"op": REQUEST, "d": body}))
        while True:
            message = json.loads(self._socket.recv())
            if message["op"] == EVENT:
                self._on_event(message["d"])
            elif message["op"] == RESPONSE and message["d"]["requestId"] == request_id:
                status = message["d"]["requestStatus"]
                if not status["result"]:
                    raise RuntimeError(f"{request_type} failed: {status.get('comment', status['code'])}")
                return message["d"].get("responseData", {})

    def next_event(self, timeout: float) -> dict | None:
        """The next event, or None if none arrives within the timeout."""
        try:
            message = json.loads(self._socket.recv(timeout=timeout))
        except TimeoutError:
            return None
        return message["d"] if message["op"] == EVENT else None
