"""The on-air logger run by the server: one at a time, stoppable, and honest about why it stopped.

The fake OBS is the one the on-air tests use, given the handshake a real
connection begins with, so the password path is driven too.
"""

import json
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import pytest
from test_onair import FakeObs
from websockets.exceptions import ConnectionClosedError

from sponsifer import onair
from sponsifer.obs import auth_string
from sponsifer.runner import Busy, Runner

SALT, CHALLENGE = "salt", "challenge"
SOURCES = ["Sponsor overlay", "Sponsor slate"]


class FakeSocket(FakeObs):
    """FakeObs behind obs-websocket's handshake: Hello, then Identify, then requests."""

    def __init__(self, password: str | None = None, inputs=SOURCES):
        super().__init__(inputs=inputs)
        self.password = password
        self.greeted = False
        self.closed = threading.Event()   # set to make OBS quit
        self.identified_with: list[str | None] = []

    def recv(self, timeout: float | None = None) -> str:
        if not self.greeted:
            self.greeted = True
            auth = {"authentication": {"salt": SALT, "challenge": CHALLENGE}} if self.password else {}
            return json.dumps({"op": 0, "d": {"rpcVersion": 1, **auth}})
        if self.closed.is_set():
            raise ConnectionClosedError(None, None)
        if self.sent and self.sent[0]["op"] == 1:
            given = self.sent[0]["d"].get("authentication")
            self.identified_with.append(given)
            if self.password and given != auth_string(self.password, SALT, CHALLENGE):
                self.sent.pop(0)
                raise ConnectionClosedError(None, None)   # OBS closes with 4009 rather than answering
        if not self.sent and not self.events and timeout:
            time.sleep(min(timeout, 0.01))
        return super().recv(timeout)


def runner_for(tmp_path: Path, *sockets: FakeSocket | None, **kwargs) -> Runner:
    """A runner whose connections to OBS are these sockets, one per start. None is an OBS that is not running."""
    waiting = list(sockets)

    @contextmanager
    def connect(url: str):
        socket = waiting.pop(0)
        if socket is None:
            raise ConnectionRefusedError("nothing is listening")
        yield socket

    return Runner(tmp_path, connect=connect, poll_every=0.01, ready_timeout=2, **kwargs)


def kinds(tmp_path: Path, deal: str = "dl-104") -> list[str]:
    return [line["kind"] for line in onair.read_log(onair.log_path(tmp_path, deal))]


def test_it_starts_watches_what_obs_has_and_stops_with_the_session_closed(tmp_path: Path):
    runner = runner_for(tmp_path, FakeSocket())
    status = runner.start("dl-104", None)
    assert status.running and status.deal == "dl-104" and status.since
    assert list(status.sources) == SOURCES
    assert list(status.missing) == ["Sponsor lower third", "Sponsor card"], "what is not being watched is named"

    stopped = runner.stop()
    assert not stopped.running and stopped.error is None
    assert kinds(tmp_path)[0] == "session" and kinds(tmp_path)[-1] == "end"


def test_it_writes_the_same_log_the_cli_does(tmp_path: Path):
    socket = FakeSocket()
    runner = runner_for(tmp_path, socket)
    runner.start("dl-104", None)
    socket.goes_live()
    socket.shows(True)
    socket.shows(False)
    deadline = time.monotonic() + 2
    while socket.events and time.monotonic() < deadline:
        time.sleep(0.01)
    runner.stop()
    delivery = onair.delivery(onair.read_log(onair.log_path(tmp_path, "dl-104")))
    assert len(delivery.intervals) == 1 and delivery.start_observed


def test_only_one_logger_runs_at_a_time(tmp_path: Path):
    runner = runner_for(tmp_path, FakeSocket())
    runner.start("dl-104", None)
    with pytest.raises(Busy) as busy:
        runner.start("dl-200", None)
    assert busy.value.deal == "dl-104"
    runner.stop()
    assert kinds(tmp_path, "dl-200") == [], "the second deal's log was never touched"


def test_an_obs_that_asks_for_a_password_is_reported_as_asking(tmp_path: Path):
    status = runner_for(tmp_path, FakeSocket(password="hunter2")).start("dl-104", None)
    assert not status.running and status.needs_password
    assert kinds(tmp_path) == [], "nothing is logged before OBS lets the logger in"


def test_the_right_password_gets_in_and_is_not_kept(tmp_path: Path):
    socket = FakeSocket(password="hunter2")
    runner = runner_for(tmp_path, socket)
    status = runner.start("dl-104", "hunter2")
    assert status.running
    assert socket.identified_with == [auth_string("hunter2", SALT, CHALLENGE)]
    runner.stop()
    assert "hunter2" not in json.dumps(runner.status().to_json())
    assert "hunter2" not in onair.log_path(tmp_path, "dl-104").read_text(encoding="utf-8")
    assert "hunter2" not in repr(vars(runner))


def test_a_wrong_password_is_said_plainly(tmp_path: Path):
    status = runner_for(tmp_path, FakeSocket(password="hunter2")).start("dl-104", "wrong")
    assert not status.running and not status.needs_password
    assert status.error == "OBS did not accept that password."


def test_obs_not_running_is_said_with_what_to_check(tmp_path: Path):
    status = runner_for(tmp_path, None).start("dl-104", None)
    assert not status.running
    assert "WebSocket server switched on" in (status.error or "")


def test_obs_quitting_mid_stream_closes_the_session_and_says_why(tmp_path: Path):
    socket = FakeSocket()
    runner = runner_for(tmp_path, socket)
    runner.start("dl-104", None)
    socket.goes_live()
    socket.shows(True)
    deadline = time.monotonic() + 2
    while socket.events and time.monotonic() < deadline:
        time.sleep(0.01)
    socket.closed.set()
    deadline = time.monotonic() + 2
    while runner.status().running and time.monotonic() < deadline:
        time.sleep(0.01)

    status = runner.status()
    assert not status.running and status.error == "OBS closed the connection, so the logger stopped."
    assert kinds(tmp_path)[-1] == "end"
    assert onair.delivery(onair.read_log(onair.log_path(tmp_path, "dl-104"))).open_since is not None, \
        "the placement was up when OBS went, and the log leaves it open rather than guessing an end"


def test_it_can_be_started_again_after_stopping(tmp_path: Path):
    runner = runner_for(tmp_path, FakeSocket(), FakeSocket())   # a new connection begins with a new handshake
    runner.start("dl-104", None)
    runner.stop()
    assert runner.start("dl-104", None).running
    runner.stop()
    assert kinds(tmp_path).count("session") == 2 and kinds(tmp_path).count("end") == 2
