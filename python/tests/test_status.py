"""`sponsifer status`: one read-only look at OBS, over a real WebSocket to a stand-in OBS."""

from __future__ import annotations

import http.server
import json
import threading
from contextlib import contextmanager
from typing import Iterator

import pytest
from test_obs_setup import FakeStudio, address
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from sponsifer import obs, status, toolkit
from sponsifer.obs import Obs, auth_string

SALT, CHALLENGE = "salt", "challenge"


@contextmanager
def obs_server(studio: FakeStudio, password: str | None = None) -> Iterator[str]:
    """A stand-in OBS on a real socket: the handshake, then `studio` answers every request. Yields its address."""

    def handler(socket) -> None:  # noqa: ANN001 - a websockets connection
        auth = {"authentication": {"salt": SALT, "challenge": CHALLENGE}} if password else {}
        socket.send(json.dumps({"op": 0, "d": {"rpcVersion": 1, **auth}}))
        try:
            identify = json.loads(socket.recv())
            if password and identify["d"].get("authentication") != auth_string(password, SALT, CHALLENGE):
                socket.close(4009, "Authentication failed")   # as OBS does: no message, a closed socket
                return
            socket.send(json.dumps({"op": 2, "d": {"negotiatedRpcVersion": 1}}))
            for raw in socket:
                body = json.loads(raw)["d"]
                socket.send(json.dumps({"op": 7, "d": {
                    "requestType": body["requestType"], "requestId": body["requestId"],
                    "requestStatus": {"result": True, "code": 100},
                    "responseData": studio._answer(body["requestType"], body.get("requestData", {}))}}))
        except ConnectionClosed:
            return   # a client that left, including one that went to ask for the password

    with serve(handler, "127.0.0.1", 0) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            yield f"ws://127.0.0.1:{server.socket.getsockname()[1]}"
        finally:
            server.shutdown()


class Studio(FakeStudio):
    """A studio that also says how many canvases it runs."""

    def __init__(self, *args, canvases: int | None = 1, **kwargs):
        super().__init__(*args, **kwargs)
        self.canvases = canvases

    def _answer(self, request: str, data: dict) -> dict:
        if request == "GetCanvasList" and self.canvases is not None:
            return {"canvases": [{"canvasName": f"c{i}"} for i in range(self.canvases)]}
        return super()._answer(request, data)


def wired(live: bool = False, canvases: int | None = 1) -> Studio:
    studio = Studio({
        "Sponsor overlay": {"kind": "browser_source", "url": address("dl-104")},
        "Sponsor slate": {"kind": "browser_source", "url": address("dl-104", "slate", origin="http://127.0.0.1:5190")},
        "Webcam": {"kind": "dshow_input"},
    }, canvases=canvases)
    studio.active.update({"Sponsor overlay": True, "Webcam": True})
    studio.live = live
    return studio


NAMES = ["Sponsor overlay", "Sponsor lower third", "Sponsor slate", "Webcam"]


def look(studio: Studio, answers=lambda url: True) -> status.View:
    studio.greeted = True   # these tests begin after the handshake
    return status.look(Obs(studio, lambda event: None), NAMES, answers)


def test_each_source_is_present_or_not_in_the_program_or_not_and_on_air_only_when_live():
    off, live = look(wired(live=False)), look(wired(live=True))
    assert [s.state for s in off.sources] == ["in-program", "missing", "not-in-program", "in-program"]
    assert [s.state for s in live.sources] == ["on-air", "missing", "not-in-program", "on-air"]
    assert off.scene == "Gameplay" and not off.stream_live and live.stream_live


def test_the_deal_an_overlay_shows_is_read_from_its_address_and_only_overlays_are_checked():
    asked: list[str] = []
    view = look(wired(), answers=lambda url: asked.append(url) or "5190" not in url)
    by_name = {s.name: s for s in view.sources}
    assert (by_name["Sponsor overlay"].shows, by_name["Sponsor overlay"].answers) == ("dl-104", True)
    assert (by_name["Sponsor slate"].loads_from, by_name["Sponsor slate"].answers) == ("127.0.0.1:5190", False)
    assert by_name["Webcam"].shows is None and len(asked) == 2, "a source with no overlay address is not probed"


def test_status_asks_obs_nothing_that_changes_it():
    studio = wired()
    look(studio)
    assert all(request.startswith("Get") for request, _ in studio.requests)


@pytest.mark.parametrize("canvases, words", [
    (1, "One canvas."),
    (2, "2 canvases. OBS says whether a source is in the program, not on which canvas, "
        "so a log cannot say which feed a placement was in."),
    (None, "OBS did not say how many canvases it is running."),
])
def test_a_second_canvas_is_named_with_what_it_costs_the_log(canvases, words):
    assert status.lines(look(wired(canvases=canvases)))[1] == words


def test_an_obs_without_canvases_is_unknown_not_one():
    class Refuses:
        def request(self, request_type: str, data: dict | None = None) -> dict:
            raise RuntimeError("GetCanvasList failed: 204")

    assert obs.canvas_count(Refuses()) is None


def test_the_lines_say_on_air_missing_and_a_dead_address():
    text = "\n".join(status.lines(look(wired(live=True), answers=lambda url: "5190" not in url)))
    assert "Sponsor overlay      ON AIR" in text
    assert "Sponsor lower third  not in OBS" in text
    assert "nothing is answering at 127.0.0.1:5190, so it may be drawing nothing" in text
    assert "Webcam               ON AIR" in text and "a dshow_input" in text


# Whether an overlay's server answers


@contextmanager
def info_server(answer: bytes = b'{"product": "Sponsifer"}') -> Iterator[int]:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the standard library's name
            self.send_response(200 if self.path == "/api/info" else 404)
            self.end_headers()
            self.wfile.write(answer)

        def log_message(self, *args) -> None:  # noqa: ANN002 - quiet
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()


def test_a_local_server_that_answers_is_served_and_a_closed_port_is_not():
    with info_server() as port:
        assert status.served(f"http://127.0.0.1:{port}/overlay.html?deal=dl-104") is True
        assert status.served(f"http://localhost:{port}/overlay.html?deal=dl-104") is True
    assert status.served(f"http://127.0.0.1:{port}/overlay.html?deal=dl-104") is False


def test_an_address_elsewhere_is_no_claim_and_is_never_asked():
    assert status.served("https://example.com/overlay.html?deal=dl-104") is None
    assert status.served("http://127.0.0.1/overlay.html?deal=dl-104") is None, "no port, nothing to ask"


# The whole command, over a real socket


@pytest.fixture
def no_probe(monkeypatch):
    """The overlays these studios name are not served, and a refused connection costs a second each on Windows."""
    monkeypatch.setattr(status, "served", lambda url: True)


@pytest.mark.usefixtures("no_probe")
def test_the_command_reports_what_obs_has(capsys):
    with obs_server(wired(live=True)) as url:
        assert toolkit.status(url, NAMES) == 0
    out = capsys.readouterr().out
    assert out.startswith("OBS 32.1.1, obs-websocket 5.5.0. Streaming. Program scene: \"Gameplay\".")
    assert "Sponsor overlay      ON AIR" in out


@pytest.mark.usefixtures("no_probe")
def test_the_password_is_asked_for_only_when_obs_asks(capsys, monkeypatch):
    monkeypatch.delenv("OBS_WEBSOCKET_PASSWORD", raising=False)
    asked: list[int] = []
    monkeypatch.setattr(toolkit, "_password", lambda: asked.append(1) or "hunter2")
    with obs_server(wired()) as url:
        assert toolkit.status(url, NAMES) == 0
    assert asked == [], "an OBS with no password set is never asked for one"
    with obs_server(wired(), password="hunter2") as url:
        assert toolkit.status(url, NAMES) == 0
    assert asked == [1]


def test_a_wrong_password_and_an_absent_obs_are_said_plainly(capsys, monkeypatch):
    monkeypatch.setattr(toolkit, "_password", lambda: "wrong")
    with obs_server(wired(), password="hunter2") as url:
        assert toolkit.status(url, NAMES) == 1
    assert capsys.readouterr().err.strip() == "OBS did not accept that password."
    assert toolkit.status(url, NAMES) == 1   # the stand-in has gone
    assert "Is its WebSocket server switched on, under Tools?" in capsys.readouterr().err
