"""The on-air log against a fake OBS, including the case the research warned about.

OBS has been known to miss an activation signal after a studio-mode
transition. The logger therefore treats events as prompts and the
GetSourceActive poll as the arbiter, and these tests drive both paths.
"""

import json
from pathlib import Path

import pytest

from sponsifer import onair
from sponsifer.obs import Obs


class FakeObs:
    """A socket whose far end is OBS, with state a test can change."""

    def __init__(self, inputs=None):
        self.live = False
        self.active = {}          # source name -> in the program feed
        self.inputs = inputs      # the sources OBS has, or None for an OBS that will not say
        self.events = []
        self.sent = []

    # -- socket interface ------------------------------------------------
    def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    def recv(self, timeout: float | None = None) -> str:
        """Answer a pending request, else deliver a queued event, else time out, as a socket would."""
        if not self.sent:
            if self.events:
                return json.dumps({"op": 5, "d": self.events.pop(0)})
            raise TimeoutError
        message = self.sent.pop(0)
        if message["op"] == 1:  # Identify
            return json.dumps({"op": 2, "d": {"negotiatedRpcVersion": 1}})
        body = message["d"]
        return json.dumps({
            "op": 7,
            "d": {
                "requestType": body["requestType"],
                "requestId": body["requestId"],
                "requestStatus": {"result": True, "code": 100},
                "responseData": self._answer(body["requestType"], body.get("requestData", {})),
            },
        })

    def _answer(self, request: str, data: dict) -> dict:
        if request == "GetVersion":
            return {"obsVersion": "32.1.1", "obsWebSocketVersion": "5.5.0"}
        if request == "GetStreamStatus":
            return {"outputActive": self.live}
        if request == "GetSourceActive":
            active = self.active.get(data.get("sourceName"), False)
            return {"videoActive": active, "videoShowing": active}
        if request == "GetInputList" and self.inputs is not None:
            return {"inputs": [{"inputName": name} for name in self.inputs]}
        return {}

    # -- test controls ---------------------------------------------------
    def goes_live(self, announce: bool = True) -> None:
        self.live = True
        if announce:
            self.events.append({"eventType": "StreamStateChanged",
                                "eventData": {"outputActive": True, "outputState": "OBS_WEBSOCKET_OUTPUT_STARTED"}})

    def shows(self, active: bool, announce: bool = True, name: str = "Sponsor overlay") -> None:
        """A source enters or leaves the program feed. `announce` False is the missed signal."""
        self.active[name] = active
        if announce:
            self.events.append({"eventType": "InputActiveStateChanged",
                                "eventData": {"inputName": name, "videoActive": active}})


@pytest.fixture
def setup(tmp_path: Path):
    fake = FakeObs()
    path = onair.log_path(tmp_path, "dl-104")
    session = onair.Session("dl-104", "Sponsor overlay", lambda line: onair.append(path, line))
    obs = Obs(fake, session.event)
    return fake, obs, session, path


def drive(fake, obs, session, steps) -> None:
    """Run the session over a scripted sequence: each step changes OBS, then one loop turn."""
    session.begin(obs)
    for step in steps:
        step()
        event = obs.next_event(0)
        if event is not None:
            session.event(event)
        else:
            session.poll(obs)
    session.end()


def summary(path: Path) -> onair.Delivery:
    return onair.delivery(onair.read_log(path))


def test_a_log_starts_empty_and_says_nothing_was_on_air(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [lambda: None])
    assert summary(path).total_seconds == 0
    assert summary(path).intervals == []


def test_time_counts_only_while_the_stream_is_live_and_the_source_is_in_the_program_feed(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [
        lambda: fake.shows(True),          # visible, but nothing is being broadcast
        lambda: fake.goes_live(),          # now it is
        lambda: fake.shows(False),         # off screen again
    ])
    delivery = summary(path)
    assert len(delivery.intervals) == 1
    assert delivery.total_seconds >= 0
    assert delivery.start_observed is True


def test_a_missed_activation_signal_is_caught_by_the_poll_and_written_down(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [
        lambda: fake.goes_live(),
        lambda: fake.shows(True, announce=False),   # the signal OBS failed to send
        lambda: None,                               # the poll that catches it
    ])
    delivery = summary(path)
    assert delivery.open_since is not None, "the poll should have opened an interval"
    assert delivery.disagreements == 1


def test_the_log_is_appended_to_and_never_rewritten(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [lambda: fake.goes_live()])
    first = path.read_text(encoding="utf-8")
    session2 = onair.Session("dl-104", "Sponsor overlay", lambda line: onair.append(path, line))
    drive(fake, Obs(fake, session2.event), session2, [lambda: None])
    assert path.read_text(encoding="utf-8").startswith(first)


def test_an_interval_left_open_is_reported_as_open_rather_than_closed(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [lambda: fake.goes_live(), lambda: fake.shows(True)])
    delivery = summary(path)
    assert delivery.open_since is not None
    assert delivery.intervals == []


def test_an_interval_a_stopped_logger_left_open_is_not_forgotten_when_it_starts_again(setup):
    fake, obs, session, path = setup
    drive(fake, obs, session, [lambda: fake.goes_live(), lambda: fake.shows(True)])  # stopped with the placement up
    left_open = summary(path).open_since
    assert left_open is not None

    again = onair.Session("dl-104", "Sponsor overlay", lambda line: onair.append(path, line))
    drive(fake, Obs(fake, again.event), again, [lambda: fake.shows(False)])          # started again, saw it leave
    delivery = summary(path)

    assert len(delivery.intervals) == 1, "the second run saw its interval whole"
    assert delivery.open_since == left_open, "the first run's interval never ended in the log, and the summary says so"
    assert delivery.placements[0].open_since == left_open


def test_following_stops_when_asked_and_leaves_the_session_to_be_closed(setup):
    fake, obs, session, path = setup
    turns = iter([False, False, True])
    onair.follow(obs, session, poll_every=0, stop=lambda: next(turns))
    kinds = [line["kind"] for line in onair.read_log(path)]
    assert kinds[0] == "session"
    assert "end" not in kinds, "stopping is the caller's to record, as Ctrl+C is in the CLI"


def test_a_stream_already_running_gives_no_offsets_into_the_recording(setup):
    fake, obs, session, path = setup
    fake.live = True  # the logger started after the stream did
    drive(fake, obs, session, [lambda: fake.shows(True), lambda: fake.shows(False)])
    delivery = summary(path)
    assert delivery.start_observed is False
    assert [i.offset_seconds for i in delivery.intervals] == [None]


def test_offsets_are_measured_from_the_start_the_logger_saw():
    lines = [
        {"kind": "session", "at": "2026-09-18T20:00:00.000+00:00", "deal": "dl-1", "source": "Sponsor overlay"},
        {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True},
        {"kind": "onair", "at": "2026-09-18T20:05:00.000+00:00", "state": "start"},
        {"kind": "onair", "at": "2026-09-18T20:06:30.000+00:00", "state": "end"},
    ]
    delivery = onair.delivery(lines)
    assert delivery.intervals[0].seconds == 90
    assert delivery.intervals[0].offset_seconds == 300
    assert delivery.total_seconds == 90


def test_the_summary_carries_the_disagreements_rather_than_hiding_them():
    lines = [
        {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True},
        {"kind": "disagreement", "at": "2026-09-18T20:01:00.000+00:00", "live": True, "active": True},
    ]
    assert onair.delivery(lines).to_json()["disagreements"] == 1


def test_a_corrupt_line_does_not_cost_the_rest_of_the_log(tmp_path: Path):
    path = tmp_path / "dl-1.jsonl"
    onair.append(path, {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True})
    path.write_text(path.read_text(encoding="utf-8") + "half a line\n", encoding="utf-8")
    onair.append(path, {"kind": "disagreement", "at": "2026-09-18T20:01:00.000+00:00"})
    assert onair.delivery(onair.read_log(path)).disagreements == 1


def test_logs_live_beside_the_ledger_not_inside_the_workspace(tmp_path: Path):
    assert onair.log_path(tmp_path, "dl-104") == tmp_path / "onair" / "dl-104.jsonl"


# Several placements on one deal


def watching(tmp_path, fake, sources):
    path = onair.log_path(tmp_path, "dl-104")
    session = onair.Session("dl-104", sources, lambda line: onair.append(path, line))
    return session, Obs(fake, session.event), path


def test_each_placement_keeps_its_own_time_on_air(tmp_path: Path):
    fake = FakeObs()
    session, obs, path = watching(tmp_path, fake, ["Sponsor overlay", "Sponsor slate"])
    drive(fake, obs, session, [
        lambda: fake.goes_live(),
        lambda: fake.shows(True),                           # the emblem goes up
        lambda: fake.shows(True, name="Sponsor slate"),     # the slate opens the segment
        lambda: fake.shows(False, name="Sponsor slate"),    # and comes down
        lambda: fake.shows(False),
    ])
    delivery = summary(path)
    assert delivery.sources == ["Sponsor overlay", "Sponsor slate"]
    assert [p.intervals for p in delivery.placements] == [1, 1]
    assert {i.source for i in delivery.intervals} == {"Sponsor overlay", "Sponsor slate"}
    assert delivery.disagreements == 0


def test_a_source_obs_does_not_have_is_left_out_and_named(tmp_path: Path):
    fake = FakeObs(inputs=["Sponsor overlay", "Webcam"])
    session, obs, path = watching(tmp_path, fake, list(onair.CONVENTIONAL_SOURCES))
    drive(fake, obs, session, [lambda: None])
    header = onair.read_log(path)[0]
    assert header["sources"] == ["Sponsor overlay"]
    assert "Sponsor slate" in header["missing"]


def test_watching_nothing_obs_has_is_refused(tmp_path: Path):
    fake = FakeObs(inputs=["Webcam"])
    session, obs, _ = watching(tmp_path, fake, ["Sponsor overlay"])
    with pytest.raises(RuntimeError, match="none of these sources exist"):
        session.begin(obs)


def test_the_total_counts_a_moment_once_however_many_placements_were_up():
    at = "2026-09-18T20:%s:00.000+00:00"
    lines = [
        {"kind": "session", "at": at % "00", "deal": "dl-1", "sources": ["Sponsor overlay", "Sponsor slate"]},
        {"kind": "stream", "at": at % "00", "live": True, "startObserved": True},
        {"kind": "onair", "at": at % "00", "source": "Sponsor overlay", "state": "start"},
        {"kind": "onair", "at": at % "10", "source": "Sponsor slate", "state": "start"},
        {"kind": "onair", "at": at % "12", "source": "Sponsor slate", "state": "end"},
        {"kind": "onair", "at": at % "30", "source": "Sponsor overlay", "state": "end"},
    ]
    delivery = onair.delivery(lines)
    totals = {p.source: p.total_seconds for p in delivery.placements}
    assert totals == {"Sponsor overlay": 1800, "Sponsor slate": 120}
    assert delivery.total_seconds == 1800, "the slate's two minutes were inside the emblem's thirty"
    assert [i.source for i in delivery.intervals] == ["Sponsor overlay", "Sponsor slate"]


def test_a_log_written_before_placements_still_folds():
    lines = [
        {"kind": "session", "at": "2026-09-18T20:00:00.000+00:00", "deal": "dl-1", "source": "Sponsor overlay"},
        {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True},
        {"kind": "onair", "at": "2026-09-18T20:05:00.000+00:00", "state": "start"},
        {"kind": "onair", "at": "2026-09-18T20:06:30.000+00:00", "state": "end"},
    ]
    delivery = onair.delivery(lines)
    assert delivery.sources == ["Sponsor overlay"]
    assert delivery.intervals[0].source == "Sponsor overlay"
    assert delivery.total_seconds == 90
