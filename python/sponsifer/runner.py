"""Run the on-air logger inside the server, so the app can start and stop it.

`sponsifer log` holds a terminal for the length of a stream. This runs the same
session on a thread of the server instead, so a creator who has the app open
needs nothing else. It writes the same log through the same `onair.Session`;
nothing here knows the log's shape.

The rules it keeps:

- **One logger at a time.** Placements are found by their conventional source
  names, which are the same for every deal, so two loggers would write the same
  minutes into two deals' logs.
- **The password is used once and not kept.** It answers OBS's challenge and is
  then dropped: it is never on the runner, in the status or in the log. Python
  cannot wipe memory, so "not kept" means no reference outlives the handshake.
- **A logger that stops says why.** The status carries the reason, and a
  session that had begun is closed with an `end` line that leaves an open
  interval open, as the CLI's is: the log says what it saw.
- **It connects only to the address the server was started with**, never to one
  a request names, so the app cannot be used to make the server call elsewhere.
"""

from __future__ import annotations

import threading
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

from . import onair
from .obs import OBS_URL, Obs, utc_now

#: Opens the socket to OBS. Replaced in tests by one that opens a fake.
Connect = Callable[[str], AbstractContextManager[Any]]

#: `Obs.identify` raises this message when OBS asks for a password and none was given.
_NEEDS_PASSWORD = "OBS requires a password"


class Busy(RuntimeError):
    """A logger is already running. `deal` is the one it is logging."""

    def __init__(self, deal: str) -> None:
        super().__init__(f"the logger is already running for {deal}")
        self.deal = deal


@dataclass(frozen=True, slots=True)
class Status:
    """What the logger is doing now, or why it is not."""

    running: bool = False
    deal: str | None = None
    since: str | None = None
    sources: tuple[str, ...] = ()
    #: Conventional sources OBS does not have, so the creator can see what is not being watched.
    missing: tuple[str, ...] = ()
    error: str | None = None
    needs_password: bool = False

    def to_json(self) -> dict[str, Any]:
        return {"running": self.running, "deal": self.deal, "since": self.since, "sources": list(self.sources),
                "missing": list(self.missing), "error": self.error, "needsPassword": self.needs_password}


def _connect(url: str) -> AbstractContextManager[Any]:
    from websockets.sync.client import connect

    return connect(url, open_timeout=5)


class Runner:
    """At most one on-air logger, on a thread of its own."""

    def __init__(self, home: Path, url: str = OBS_URL, connect: Connect = _connect,
                 poll_every: float = 2.0, ready_timeout: float = 8.0) -> None:
        self._home, self._url, self._connect = home, url, connect
        self._poll_every, self._ready_timeout = poll_every, ready_timeout
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._status = Status()

    def status(self) -> Status:
        with self._lock:
            return self._status

    def start(self, deal_id: str, password: str | None) -> Status:
        """
        Start logging a deal, and wait until OBS has answered or refused.

        Raises `Busy` when a logger is already running, whichever deal it is for.
        """
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise Busy(self._status.deal or "")
            stop, ready = threading.Event(), threading.Event()
            # Handed over in a list the thread empties, so no reference outlives the handshake.
            secret = [password]
            self._stop, self._status = stop, Status(deal=deal_id)
            self._thread = threading.Thread(target=self._run, args=(deal_id, secret, stop, ready),
                                            name=f"onair-{deal_id}", daemon=True)
            self._thread.start()
        ready.wait(self._ready_timeout)
        return self.status()

    def stop(self, wait: float = 10.0) -> Status:
        """Ask the logger to stop, and wait for its `end` line. Safe to call when none is running."""
        with self._lock:
            thread = self._thread
            self._stop.set()
        if thread is not None:
            thread.join(wait)
        return self.status()

    def _set(self, **changes: Any) -> None:
        with self._lock:
            self._status = replace(self._status, **changes)

    def _run(self, deal_id: str, secret: list[str | None], stop: threading.Event, ready: threading.Event) -> None:
        from websockets.exceptions import WebSocketException

        path = onair.log_path(self._home, deal_id)
        asked = list(onair.CONVENTIONAL_SOURCES)
        session = onair.Session(deal_id, asked, lambda line: onair.append(path, line))
        phase, begun, gave_password = "connect", False, secret[0] is not None
        try:
            with self._connect(self._url) as socket:
                obs = Obs(socket, session.event)
                phase = "identify"
                obs.identify(secret.pop())
                phase = "begin"
                session.begin(obs)
                begun = True
                watched = tuple(session.sources)
                self._set(running=True, since=utc_now(), sources=watched,
                          missing=tuple(name for name in asked if name not in watched))
                ready.set()
                phase = "listen"
                onair.listen(obs, session, self._poll_every, stop=stop.is_set)
        except (OSError, RuntimeError, WebSocketException) as error:
            refused = phase == "identify" and gave_password and not isinstance(error, RuntimeError)
            self._set(error=_reason(phase, error, self._url, refused), needs_password=str(error) == _NEEDS_PASSWORD)
        except Exception as error:
            # Not one of OBS's ways of failing. Say so in the status, then let it surface.
            self._set(error=f"the logger stopped on an unexpected error ({type(error).__name__})")
            raise
        finally:
            secret.clear()
            if begun:
                session.end()
            self._set(running=False)
            ready.set()


def _reason(phase: str, error: BaseException, url: str, password_refused: bool) -> str:
    """Why the logger is not running, in words the creator can act on."""
    if str(error) == _NEEDS_PASSWORD:
        return "OBS asks for its WebSocket password."
    if password_refused:
        # OBS answers a wrong password by closing the socket, not with a message.
        return "OBS did not accept that password."
    if phase == "connect":
        return f"OBS is not answering at {url}. Is its WebSocket server switched on, under Tools?"
    if phase == "listen":
        return "OBS closed the connection, so the logger stopped."
    return f"OBS: {error}."
