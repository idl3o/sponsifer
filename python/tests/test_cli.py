"""The command line's workspace defaults: the served file unless told otherwise."""

import argparse
from pathlib import Path

import pytest

from sponsifer import cli, workspace


def parse(*argv):
    return cli._parser().parse_args(argv)


def test_seal_and_verify_default_to_the_served_file(tmp_path: Path):
    home = tmp_path / "home"
    args = parse("seal", "dl-104", "reel.png", "--source", "capture")
    assert args.workspace is None
    assert cli._workspace(args, home) == workspace.default_path(home)
    assert cli._workspace(parse("verify", "ad.jpg", "--started", "2026-10-01"), home) == workspace.default_path(home)


def test_a_named_workspace_is_used_as_given(tmp_path: Path):
    args = parse("seal", "dl-104", "reel.png", "--source", "capture", "--workspace", "exported.json")
    assert cli._workspace(args, tmp_path) == Path("exported.json")


def test_the_served_file_needs_no_import_but_an_exported_one_does(tmp_path: Path):
    served = argparse.Namespace(workspace=None)
    named = argparse.Namespace(workspace=Path("exported.json"))
    assert cli._pick_up_line(served, tmp_path / "workspace.json", "and set the delivery date") == (
        "The app picks this up on its own."
    )
    assert "import exported.json into the app and set the delivery date" in cli._pick_up_line(
        named, Path("exported.json"), "and set the delivery date"
    )


def test_serve_takes_a_workspace_an_api_only_mode_and_extra_origins():
    args = parse("serve", "--api-only", "--port", "5181", "--allow-origin", "http://localhost:5180",
                 "--workspace", "scratch.json")
    assert (args.api_only, args.port, args.allow_origin) == (True, 5181, ["http://localhost:5180"])
    assert args.workspace == Path("scratch.json")
    plain = parse("serve")
    assert (plain.api_only, plain.allow_origin, plain.workspace) == (False, [], None)


def test_sealing_says_where_the_workspace_should_be_rather_than_raising(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(cli, "_watermark_installed", lambda: True)
    home = tmp_path / "home"
    args = parse("seal", "dl-104", str(tmp_path / "reel.png"), "--source", "capture")
    assert cli._seal(args, home) == 1
    error = capsys.readouterr().err
    assert str(workspace.default_path(home)) in error
    assert "sponsifer serve" in error


@pytest.mark.parametrize(
    "argv",
    [("seal", "dl-104", "reel.png", "--source", "capture"), ("verify", "ad.jpg", "--started", "2026-10-01")],
    ids=["seal", "verify"],
)
def test_every_command_that_writes_takes_a_workspace_flag(argv):
    assert parse(*argv, "--workspace", "elsewhere.json").workspace == Path("elsewhere.json")


def test_log_watches_every_placement_unless_told_which():
    assert parse("log", "dl-104").source is None, "None means every placement's usual name"
    named = parse("log", "dl-104", "--source", "Sponsor overlay", "--source", "My slate")
    assert named.source == ["Sponsor overlay", "My slate"]
