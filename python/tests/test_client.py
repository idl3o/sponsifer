"""`sponsifer setup`, `overlay` and `dock`: the toolkit asking the running app, end to end over real sockets.

The command line talks HTTP to a real server, which talks WebSocket to a
stand-in OBS, so the server's rules are the ones exercised: its own address
given to OBS, the Origin guard, the password used once.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pytest
from test_obs_setup import FakeStudio, address
from test_status import obs_server

from sponsifer import cli, client, lock, toolkit, workspace
from sponsifer.serve import make_server


def deals_file(tmp_path: Path) -> Path:
    path = tmp_path / "workspace.json"
    workspace.save(path, {"version": workspace.SUPPORTED_VERSION, "profile": {"name": "Ada"},
                          "deals": [{"id": "dl-104", "outcome": "won"}, {"id": "dl-300", "outcome": "lost"}]},
                   expected=workspace.ABSENT)
    return path


@contextmanager
def app(tmp_path: Path, obs_url: str) -> Iterator[int]:
    """`sponsifer app --api-only` on a free port, reaching OBS at `obs_url`. Yields the port."""
    server = make_server(deals_file(tmp_path), port=0, api_only=True, home=tmp_path, obs_url=obs_url)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.ctx.port
    finally:
        server.shutdown()
        server.server_close()


def test_setup_goes_through_the_server_which_gives_obs_its_own_address(tmp_path: Path, capsys):
    studio = FakeStudio()
    with obs_server(studio) as obs_url, app(tmp_path, obs_url) as port:
        assert toolkit.setup(port, "dl-104") == 0
    assert {item["url"] for item in studio.studio.values()} == {
        address("dl-104", kind, origin=f"http://127.0.0.1:{port}") for kind in (None, "lower-third", "slate", "card")}
    out = capsys.readouterr().out
    assert out.startswith("Put dl-104 into OBS:")
    assert '  Sponsor overlay: made, in the scene "Gameplay", hidden until you show it' in out


def test_the_password_goes_once_and_only_when_obs_asks(tmp_path: Path, capsys, monkeypatch):
    monkeypatch.delenv("OBS_WEBSOCKET_PASSWORD", raising=False)
    asked: list[int] = []
    monkeypatch.setattr(toolkit, "_password", lambda: asked.append(1) or "hunter2")
    studio = FakeStudio({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-101", origin="http://127.0.0.1:5190")}})
    with obs_server(studio, password="hunter2") as obs_url, app(tmp_path, obs_url) as port:
        assert toolkit.setup(port, "dl-104") == 0
    assert asked == [1]
    assert "  Sponsor overlay: pointed at dl-104 (it was showing dl-101)" in capsys.readouterr().out


def test_the_servers_refusals_are_passed_on(tmp_path: Path, capsys):
    with obs_server(FakeStudio()) as obs_url, app(tmp_path, obs_url) as port:
        assert toolkit.setup(port, "dl-300") == 1
        assert "dl-300 is not a won deal" in capsys.readouterr().err
        held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
        assert toolkit.setup(port, "dl-104") == 1
        assert "in a terminal" in capsys.readouterr().err, "not while a terminal logs"
        held.release()


def test_with_no_server_it_says_to_start_the_app(capsys):
    with app_port_closed() as port:
        assert toolkit.setup(port, "dl-104") == 1
    error = capsys.readouterr().err
    assert f"nothing is answering at http://127.0.0.1:{port}" in error and "Start `sponsifer app` first" in error


@contextmanager
def app_port_closed() -> Iterator[int]:
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    yield port


def test_the_client_sends_the_servers_own_origin_and_a_length(tmp_path: Path):
    """The server's Origin guard keeps foreign pages out; it must not keep its own command line out."""
    with app(tmp_path, "ws://127.0.0.1:9") as port:
        reply = client.post(port, "/api/logger/stop", {})
    assert reply.status == 200 and reply.body["running"] is False


def test_an_answer_that_is_not_json_is_an_error_with_its_status():
    assert client.Reply(500).error == "the server answered 500"
    assert client._body(b"<html>") == {} and client._body(b"[1]") == {}


@pytest.mark.parametrize("action, words", [
    ("keep", "already right"),
    ("blocked", "left alone: OBS has something else by this name that is not a browser source"),
])
def test_every_action_is_said(action, words):
    result = {"deal": "dl-104", "scene": "S", "steps": [{"source": "Sponsor card", "action": action, "was": None}]}
    assert client.setup_lines(result) == [f"  Sponsor card: {words}"]


# overlay and dock: addresses, built from the port, needing nothing running


def test_overlay_lists_each_placement_by_the_name_the_logger_looks_for(tmp_path: Path, capsys):
    args = cli._parser().parse_args(["overlay", "dl-104", "--port", "5199", "--workspace", str(deals_file(tmp_path))])
    assert cli._run(args, tmp_path) == 0
    out = capsys.readouterr().out
    assert "  Sponsor overlay      http://127.0.0.1:5199/overlay.html?deal=dl-104\n" in out
    assert "  Sponsor card         http://127.0.0.1:5199/overlay.html?deal=dl-104&kind=card\n" in out


def test_overlay_refuses_a_deal_that_was_not_won(tmp_path: Path, capsys):
    args = cli._parser().parse_args(["overlay", "dl-300", "--workspace", str(deals_file(tmp_path))])
    assert cli._run(args, tmp_path) == 1
    assert "not a won deal" in capsys.readouterr().err


def test_dock_names_its_address_and_where_it_goes(capsys):
    assert cli._run(cli._parser().parse_args(["dock", "--port", "5199"]), Path(".")) == 0
    out = capsys.readouterr().out
    assert "Docks, Custom Browser Docks" in out and "http://127.0.0.1:5199/dock.html" in out


# The command line's shape


def test_a_bare_command_lists_the_tools_and_starts_nothing(capsys):
    assert cli._run(cli._parser().parse_args([]), Path(".")) == 0
    out = capsys.readouterr().out
    assert out.startswith("Sponsifer: put a sponsor on stream through OBS")
    assert "sponsifer status" in out and "sponsifer seal-model" in out


def test_app_is_the_command_and_serve_still_works():
    assert cli._parser().parse_args(["app", "--port", "5181"]).port == 5181
    assert cli._parser().parse_args(["serve", "--api-only"]).api_only is True


def test_every_command_has_a_handler():
    names = set(cli._parser()._subparsers._group_actions[0].choices)
    assert names == set(cli._COMMANDS)


def test_setup_means_obs_and_the_model_download_is_seal_model():
    assert cli._parser().parse_args(["setup", "dl-104"]).deal == "dl-104"
    with pytest.raises(SystemExit):
        cli._parser().parse_args(["setup"])   # a deal is required: this is not the model download any more
    assert cli._parser().parse_args(["seal-model"]).command == "seal-model"


def test_status_looks_at_every_placement_unless_told_which():
    assert cli._parser().parse_args(["status"]).source is None
    assert cli._parser().parse_args(["status", "--source", "Webcam"]).source == ["Webcam"]
