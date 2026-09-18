"""The workspace file: atomic, compare-and-swap writes, and where it lives."""

import json
from pathlib import Path

import pytest

from sponsifable import workspace


def ws(**extra):
    return {"version": 5, "profile": {"name": "Ada"}, "terms": {}, "prospects": [], "deals": [], "board": {}, **extra}


def test_the_served_workspace_sits_beside_the_ledger(tmp_path: Path):
    assert workspace.default_path(tmp_path) == tmp_path / "workspace.json"


def test_save_returns_the_revision_of_what_it_wrote(tmp_path: Path):
    path = tmp_path / "workspace.json"
    rev = workspace.save(path, ws())
    assert rev == workspace.revision(path.read_bytes()) == workspace.current_revision(path)


def test_a_missing_file_has_the_absent_revision(tmp_path: Path):
    assert workspace.current_revision(tmp_path / "nope.json") == workspace.ABSENT


def test_save_refuses_when_the_file_moved_since_it_was_read(tmp_path: Path):
    path = tmp_path / "workspace.json"
    first = workspace.save(path, ws())
    workspace.save(path, ws(notes="someone else"))
    with pytest.raises(workspace.Changed):
        workspace.save(path, ws(notes="mine"), expected=first)
    assert json.loads(path.read_text(encoding="utf-8"))["notes"] == "someone else"


def test_create_only_refuses_an_existing_file(tmp_path: Path):
    path = tmp_path / "workspace.json"
    workspace.save(path, ws())
    with pytest.raises(workspace.Changed):
        workspace.save(path, ws(), expected=workspace.ABSENT)


def test_a_failed_write_leaves_no_temporary_file(tmp_path: Path):
    path = tmp_path / "workspace.json"
    with pytest.raises(TypeError):
        workspace.save(path, {"version": 4, "bad": object()})
    assert list(tmp_path.iterdir()) == []


def test_update_reruns_the_change_on_a_file_that_moved(tmp_path: Path):
    path = tmp_path / "workspace.json"
    workspace.save(path, ws(deals=[{"id": "dl-1", "sightings": []}]))
    calls = []

    def change(data):
        calls.append(1)
        if len(calls) == 1:  # the app saves between the CLI's read and its write
            workspace.save(path, {**data, "profile": {"name": "Ada, edited"}})
        data["deals"][0]["sightings"].append({"id": "st-verify-x-1"})
        return True

    assert workspace.update(path, change)
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert len(calls) == 2
    assert saved["profile"]["name"] == "Ada, edited"
    assert saved["deals"][0]["sightings"] == [{"id": "st-verify-x-1"}]


def test_update_writes_nothing_when_nothing_changed(tmp_path: Path):
    path = tmp_path / "workspace.json"
    rev = workspace.save(path, ws())
    assert not workspace.update(path, lambda data: False)
    assert workspace.current_revision(path) == rev
