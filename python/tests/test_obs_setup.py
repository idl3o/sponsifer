"""Putting a deal's placements into OBS, and the rule that makes re-pointing safe.

A streamer builds their scenes once. So putting a sponsor into OBS creates the
conventional sources that are missing and points the ones that exist at this
deal, rather than making a new set per sponsor. That means a source can show
another sponsor's art, and a log written while it does would be evidence of the
wrong thing, so the logger refuses to begin.
"""

import json
from pathlib import Path

import pytest
from test_onair import FakeObs
from test_runner import FakeSocket, runner_for

from sponsifer import obs_setup, onair
from sponsifer.obs import Obs

PORT = 5180


def address(deal: str, kind: str | None = None, origin: str = f"http://127.0.0.1:{PORT}") -> str:
    return f"{origin}/overlay.html?deal={deal}" + (f"&kind={kind}" if kind else "")


class FakeStudio(FakeSocket):
    """An OBS with inputs a test can see being made and re-pointed."""

    def __init__(self, inputs: dict[str, dict] | None = None, scene: str = "Gameplay", **kwargs):
        self.studio = dict(inputs or {})          # name -> {"kind": ..., "url": ...}
        self.scene = scene
        self.requests: list[tuple[str, dict]] = []
        super().__init__(inputs=list(self.studio), **kwargs)

    def _answer(self, request: str, data: dict) -> dict:
        self.requests.append((request, data))
        if request == "GetInputList":
            return {"inputs": [{"inputName": n, "inputKind": i["kind"]} for n, i in self.studio.items()]}
        if request == "GetInputSettings":
            item = self.studio[data["inputName"]]
            return {"inputKind": item["kind"], "inputSettings": {"url": item["url"]} if item.get("url") else {}}
        if request == "GetCurrentProgramScene":
            return {"currentProgramSceneName": self.scene}
        if request == "GetVideoSettings":
            return {"baseWidth": 2560, "baseHeight": 1440}
        if request == "CreateInput":
            self.studio[data["inputName"]] = {"kind": data["inputKind"], "url": data["inputSettings"]["url"],
                                              "scene": data["sceneName"], "enabled": data["sceneItemEnabled"],
                                              "size": (data["inputSettings"]["width"], data["inputSettings"]["height"])}
            return {}
        if request == "SetInputSettings":
            self.studio[data["inputName"]]["url"] = data["inputSettings"]["url"]
            return {}
        return super()._answer(request, data)

    def made(self, request: str) -> list[dict]:
        return [data for name, data in self.requests if name == request]


def obs_for(studio: FakeStudio) -> Obs:
    studio.greeted = True   # these tests begin after the handshake
    return Obs(studio, lambda event: None)


# Addresses


def test_the_address_the_server_builds_is_the_one_the_app_shows():
    assert obs_setup.overlay_url(PORT, "dl-104", None) == address("dl-104")
    assert obs_setup.overlay_url(PORT, "dl-104", "slate") == address("dl-104", "slate")


@pytest.mark.parametrize("url, deal", [
    (address("dl-104"), "dl-104"),
    (address("dl-104", "card", origin="http://localhost:5173"), "dl-104"),   # pasted from Vite, by hand
    ("https://example.com/overlay.html?deal=dl-104", "dl-104"),
    ("https://example.com/something-else", None),
    ("not a url", None),
    ("", None),
    (None, None),
])
def test_the_deal_a_source_is_showing_is_read_from_its_address(url, deal):
    assert onair.deal_shown(url) == deal


def test_every_conventional_source_has_a_kind_and_no_other_does():
    assert tuple(onair.PLACEMENT_KINDS) == onair.CONVENTIONAL_SOURCES
    assert onair.PLACEMENT_KINDS["Sponsor overlay"] is None, "the emblem's address names no kind, so old sources keep working"


def test_the_kinds_here_are_the_kinds_the_app_draws():
    """The names and kinds live in two languages on purpose. This is what stops them drifting."""
    emblem = Path(__file__).resolve().parents[2] / "src" / "domain" / "emblem.ts"
    if not emblem.exists():
        pytest.skip("the app's source is not in this distribution")
    text = emblem.read_text(encoding="utf-8")
    for source, kind in onair.PLACEMENT_KINDS.items():
        assert f"value: '{kind or 'emblem'}'" in text and f"sourceName: '{source}'" in text, source


# The plan


def test_an_empty_obs_gets_all_four_made_hidden_in_the_scene_on_screen_at_the_canvas_size():
    studio = FakeStudio()
    result = obs_setup.setup(obs_for(studio), PORT, "dl-104")
    assert result.scene == "Gameplay"
    assert [s.action for s in result.steps] == ["create"] * 4
    slate = studio.studio["Sponsor slate"]
    assert slate["url"] == address("dl-104", "slate") and slate["kind"] == "browser_source"
    assert slate["scene"] == "Gameplay" and slate["size"] == (2560, 1440)
    assert slate["enabled"] is False, "nothing appears on stream that the streamer did not show"


def test_sources_that_exist_are_pointed_at_this_deal_and_the_rest_left_alone():
    studio = FakeStudio({
        "Sponsor overlay": {"kind": "browser_source", "url": address("dl-101")},          # another sponsor's
        "Sponsor slate": {"kind": "browser_source", "url": address("dl-104", "slate")},   # already right
        "Webcam": {"kind": "dshow_input", "url": None},
    })
    result = obs_setup.setup(obs_for(studio), PORT, "dl-104")
    by_source = {s.source: s for s in result.steps}
    assert by_source["Sponsor overlay"].action == "repoint" and by_source["Sponsor overlay"].was == "dl-101"
    assert by_source["Sponsor slate"].action == "keep"
    assert by_source["Sponsor card"].action == "create"
    assert studio.studio["Sponsor overlay"]["url"] == address("dl-104")
    assert [d["inputName"] for d in studio.made("SetInputSettings")] == ["Sponsor overlay"], "only what was wrong is touched"
    assert studio.studio["Webcam"] == {"kind": "dshow_input", "url": None}


def test_localhost_is_this_server_too_so_an_address_pasted_that_way_is_kept():
    pasted = address("dl-104", "card", origin=f"http://localhost:{PORT}")
    studio = FakeStudio({"Sponsor card": {"kind": "browser_source", "url": pasted}})
    result = obs_setup.setup(obs_for(studio), PORT, "dl-104")
    assert {s.source: s.action for s in result.steps}["Sponsor card"] == "keep"
    assert studio.studio["Sponsor card"]["url"] == pasted


def test_the_right_deal_at_an_address_nothing_serves_is_still_pointed_here():
    # Found in the first real OBS this met: a source left aimed at an old demo's port, for the very deal in hand.
    studio = FakeStudio({
        "Sponsor overlay": {"kind": "browser_source", "url": address("dl-104", origin="http://127.0.0.1:5190")},
        "Sponsor slate": {"kind": "browser_source", "url": address("dl-104", "card")},   # the wrong kind for its name
    })
    result = obs_setup.setup(obs_for(studio), PORT, "dl-104")
    by_source = {s.source: s for s in result.steps}
    assert by_source["Sponsor overlay"].action == "repoint" and by_source["Sponsor overlay"].was is None
    assert by_source["Sponsor slate"].action == "repoint"
    assert studio.studio["Sponsor overlay"]["url"] == address("dl-104")
    assert studio.studio["Sponsor slate"]["url"] == address("dl-104", "slate")


def test_something_else_wearing_a_conventional_name_is_never_touched_and_is_named():
    studio = FakeStudio({"Sponsor overlay": {"kind": "image_source", "url": None}})
    result = obs_setup.setup(obs_for(studio), PORT, "dl-104")
    assert {s.source: s.action for s in result.steps}["Sponsor overlay"] == "blocked"
    assert studio.studio["Sponsor overlay"] == {"kind": "image_source", "url": None}
    assert "Sponsor overlay" not in [d["inputName"] for d in studio.made("SetInputSettings") + studio.made("CreateInput")]


def test_it_never_removes_shows_or_hides_anything():
    studio = FakeStudio({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-101")}})
    obs_setup.setup(obs_for(studio), PORT, "dl-104")
    asked = {name for name, _ in studio.requests}
    assert asked <= {"GetInputList", "GetInputSettings", "GetCurrentProgramScene", "GetVideoSettings", "CreateInput", "SetInputSettings"}


def test_the_result_says_what_was_done_in_a_shape_the_app_reads():
    result = obs_setup.setup(obs_for(FakeStudio({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-101")}})), PORT, "dl-104")
    data = json.loads(json.dumps(result.to_json()))
    assert data["scene"] == "Gameplay" and data["deal"] == "dl-104"
    assert data["steps"][0] == {"source": "Sponsor overlay", "action": "repoint", "was": "dl-101"}


# The logger's side of the bargain


def test_the_logger_refuses_to_begin_while_a_watched_source_shows_another_sponsor(tmp_path: Path):
    studio = FakeStudio({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-101")}})
    status = runner_for(tmp_path, studio).start("dl-104", None)
    assert not status.running
    assert "Sponsor overlay is showing dl-101, not dl-104" in (status.error or "")
    assert onair.read_log(onair.log_path(tmp_path, "dl-104")) == [], "no evidence is written for the wrong sponsor"


def test_the_log_records_what_each_source_was_showing_when_the_session_began(tmp_path: Path):
    studio = FakeStudio({
        "Sponsor overlay": {"kind": "browser_source", "url": address("dl-104")},
        "Sponsor card": {"kind": "browser_source", "url": "https://example.com/hand-made"},
    })
    runner = runner_for(tmp_path, studio)
    assert runner.start("dl-104", None).running
    runner.stop()
    session = onair.read_log(onair.log_path(tmp_path, "dl-104"))[0]
    assert session["pointsAt"] == {"Sponsor overlay": "dl-104", "Sponsor card": None}, "an address it cannot read is no claim either way"


def test_an_obs_that_will_not_say_what_a_source_shows_does_not_stop_the_logger(tmp_path: Path):
    # The plain fake answers GetInputSettings with nothing, as an older OBS or a hand-made source might.
    fake = FakeObs(inputs=["Sponsor overlay"])
    path = onair.log_path(tmp_path, "dl-104")
    session = onair.Session("dl-104", "Sponsor overlay", lambda line: onair.append(path, line))
    session.begin(Obs(fake, session.event))
    assert onair.read_log(path)[0]["pointsAt"] == {"Sponsor overlay": None}


# Through the runner: one connection policy, and never while logging


def test_setup_is_refused_while_the_logger_runs_because_the_log_has_already_said_what_the_sources_show(tmp_path: Path):
    from sponsifer.runner import Busy

    runner = runner_for(tmp_path, FakeStudio({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-104")}}), FakeStudio())
    runner.start("dl-104", None)
    with pytest.raises(Busy):
        runner.with_obs(None, lambda obs: obs_setup.setup(obs, PORT, "dl-200"))
    runner.stop()


def test_setup_goes_through_the_same_password_handling_as_the_logger(tmp_path: Path):
    from sponsifer.runner import ObsRefused

    with pytest.raises(ObsRefused) as asked:
        runner_for(tmp_path, FakeStudio(password="hunter2")).with_obs(None, lambda obs: obs_setup.setup(obs, PORT, "dl-104"))
    assert asked.value.needs_password

    with pytest.raises(ObsRefused) as wrong:
        runner_for(tmp_path, FakeStudio(password="hunter2")).with_obs("nope", lambda obs: obs_setup.setup(obs, PORT, "dl-104"))
    assert str(wrong.value) == "OBS did not accept that password."

    studio = FakeStudio(password="hunter2")
    result = runner_for(tmp_path, studio).with_obs("hunter2", lambda obs: obs_setup.setup(obs, PORT, "dl-104"))
    assert len(result.steps) == 4 and "Sponsor overlay" in studio.studio
