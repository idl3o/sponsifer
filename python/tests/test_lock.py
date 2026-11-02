"""One on-air logger on the machine: a terminal's, a server's, or a setup, never two at once."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from test_api import body, logger_ctx, post, setup
from test_runner import FakeSocket, runner_for

from sponsifer import cli, lock, workspace
from sponsifer.runner import Busy

PYTHON_DIR = Path(__file__).resolve().parents[1]


def test_a_second_holder_is_refused_and_told_who_has_it(tmp_path: Path):
    held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    with pytest.raises(lock.Held) as refused:
        lock.acquire(tmp_path, {"deal": "dl-200"}, "app")
    assert refused.value.holder["deal"] == "dl-104" and refused.value.holder["by"] == "terminal"
    assert str(refused.value).startswith("in a terminal (process ")
    held.release()


def test_released_it_can_be_taken_again_and_releasing_twice_is_harmless(tmp_path: Path):
    held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    held.release()
    held.release()
    lock.acquire(tmp_path, {"deal": "dl-200"}, "app").release()


@pytest.mark.parametrize("holder, words", [
    ({"by": "terminal", "pid": 7, "since": "2026-11-02T20:00:00Z"}, "in a terminal (process 7), since 2026-11-02T20:00:00Z"),
    ({"by": "app", "pid": 7}, "in another Sponsifer server (process 7)"),
    ({"by": "setup"}, "while a sponsor is being put into OBS"),
    ({}, "in another process"),
])
def test_the_holder_is_described_from_whatever_it_wrote(holder, words):
    assert lock.describe(holder) == words


CHILD = """
import os, sys, time
from pathlib import Path
from sponsifer import lock
held = lock.acquire(Path(sys.argv[1]), {"deal": "dl-104"}, "terminal")
print(os.getpid(), flush=True)
time.sleep(60)
"""


def test_another_process_holds_it_and_a_process_that_dies_lets_it_go(tmp_path: Path):
    """No stale-lock rule: the operating system releases a dead holder's lock."""
    env = {**os.environ, "PYTHONPATH": str(PYTHON_DIR)}
    child = subprocess.Popen([sys.executable, "-c", CHILD, str(tmp_path)], stdout=subprocess.PIPE, text=True, env=env)
    try:
        # On Windows a venv's python.exe is a launcher, so the holder's pid is the one it prints, not child.pid.
        holder_pid = int(child.stdout.readline())
        with pytest.raises(lock.Held) as refused:
            lock.acquire(tmp_path, {"deal": "dl-200"}, "terminal")
        assert refused.value.holder == {**refused.value.holder, "pid": holder_pid, "deal": "dl-104", "by": "terminal"}
        os.kill(holder_pid, signal.SIGTERM)
    finally:
        child.kill()
        child.wait()
    deadline = time.monotonic() + 5
    while True:
        try:
            lock.acquire(tmp_path, {"deal": "dl-200"}, "terminal").release()
            break
        except lock.Held:
            assert time.monotonic() < deadline, "a dead holder's lock was never released"
            time.sleep(0.05)


def test_the_server_will_not_start_a_logger_while_a_terminal_runs_one(tmp_path: Path):
    held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    runner = runner_for(tmp_path, FakeSocket())
    with pytest.raises(Busy) as busy:
        runner.start("dl-104", None)
    assert busy.value.deal == "dl-104" and "in a terminal" in (busy.value.elsewhere or "")
    assert not runner.status().running
    held.release()


def test_the_app_is_refused_even_for_the_same_deal_when_the_logger_is_a_terminals(tmp_path: Path):
    """A second Start for the same deal is not an error only when this server is the one logging it."""
    held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    ctx = logger_ctx(tmp_path, FakeSocket())
    refused = post(ctx, "start", {"deal": "dl-104"})
    assert refused.status == 409 and "in a terminal" in body(refused)["error"]
    assert body(post(ctx, "stop"))["running"] is False, "the server has nothing of its own to stop"
    held.release()


def test_obs_is_not_changed_while_a_terminal_logs(tmp_path: Path):
    from test_obs_setup import FakeStudio

    held = lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    studio = FakeStudio()
    refused = setup(logger_ctx(tmp_path, studio), {"deal": "dl-200"})
    assert refused.status == 409 and "in a terminal" in body(refused)["error"]
    assert studio.requests == [], "OBS was not even asked"
    held.release()


def test_the_server_releases_the_lock_when_its_logger_stops(tmp_path: Path):
    runner = runner_for(tmp_path, FakeSocket(), None)
    assert runner.start("dl-104", None).running
    with pytest.raises(lock.Held):
        lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal")
    runner.stop()
    lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal").release()
    assert not runner.start("dl-104", None).running, "an OBS that is not there still releases it"
    lock.acquire(tmp_path, {"deal": "dl-104"}, "terminal").release()


def test_the_terminal_logger_will_not_start_while_the_app_logs(tmp_path: Path, capsys):
    path = tmp_path / "workspace.json"
    workspace.save(path, {"version": workspace.SUPPORTED_VERSION, "deals": [{"id": "dl-104", "outcome": "won"}]},
                   expected=workspace.ABSENT)
    held = lock.acquire(tmp_path, {"deal": "dl-200"}, "app")
    args = cli._parser().parse_args(["log", "dl-104", "--workspace", str(path)])
    assert cli._log(args, tmp_path) == 1
    error = capsys.readouterr().err
    assert "in another Sponsifer server" in error and "stop that one first" in error
    assert json.loads((tmp_path / "onair" / lock.HOLDER_NAME).read_text())["deal"] == "dl-200", "the holder is untouched"
    held.release()
