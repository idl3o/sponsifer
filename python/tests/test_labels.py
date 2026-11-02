"""Logs and reports with no deal: any source, under a label, beside the sponsors' logs and never among them."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_obs_setup import FakeStudio, address
from test_report import LOG, SIGNER, build, notice_for

from sponsifer import cli, keys, lock, onair, receipt, report
from sponsifer.obs import Obs

FIXTURES = Path(__file__).parent / "fixtures"
LABEL = onair.Label("stream-1102")


# A deal's report has not moved


def test_a_deals_report_is_the_same_document_it_was_before_labels():
    assert receipt.canonical(build()) == (FIXTURES / "deal-report-v2.json").read_bytes()
    assert notice_for(build()) == (FIXTURES / "deal-report-v2.txt").read_text(encoding="utf-8")


# Labels


@pytest.mark.parametrize("name", ["stream-1102", "a", "2026.11.02_evening", "x" * 64])
def test_a_label_is_a_safe_filename(name):
    assert onair.Label(name).name == name


@pytest.mark.parametrize("name", ["", "../escape", "a/b", "a\\b", "Upper", "-leading", ".hidden", "x" * 65, "white space"])
def test_anything_that_could_leave_its_folder_or_surprise_a_filesystem_is_refused(name):
    with pytest.raises(ValueError, match="is not a label"):
        onair.Label(name)


def test_a_labels_log_has_a_folder_of_its_own(tmp_path: Path):
    """So a label can never take the file of a deal recorded later under the same name."""
    assert onair.log_path(tmp_path, onair.Label("dl-104")) == tmp_path / "onair" / "labels" / "dl-104.jsonl"
    assert onair.log_path(tmp_path, "dl-104") == tmp_path / "onair" / "dl-104.jsonl"


def studio_with(inputs: dict) -> tuple[FakeStudio, Obs]:
    studio = FakeStudio(inputs)
    studio.greeted = True
    return studio, Obs(studio, lambda event: None)


def test_a_label_log_names_its_label_and_no_deal(tmp_path: Path):
    studio, obs = studio_with({"Webcam": {"kind": "dshow_input"}})
    path = onair.log_path(tmp_path, LABEL)
    session = onair.Session(LABEL, ["Webcam"], lambda line: onair.append(path, line))
    session.begin(obs)
    studio.goes_live()
    studio.shows(True, name="Webcam")
    onair.listen(obs, session, poll_every=0, polls=1)
    session.end()
    lines = onair.read_log(path)
    assert all(line.get("label") == "stream-1102" and "deal" not in line for line in lines)
    folded = onair.delivery(lines)
    assert folded.subject == LABEL and folded.to_json()["label"] == "stream-1102" and "deal" not in folded.to_json()


def test_a_label_will_not_log_a_source_that_shows_a_sponsor(tmp_path: Path):
    """A sponsor's minutes belong in its deal's log, where its report can find them."""
    _, obs = studio_with({"Sponsor overlay": {"kind": "browser_source", "url": address("dl-104")}})
    path = onair.log_path(tmp_path, LABEL)
    session = onair.Session(LABEL, ["Sponsor overlay"], lambda line: onair.append(path, line))
    with pytest.raises(RuntimeError, match=r"Sponsor overlay is showing dl-104\. Log it as `sponsifer log dl-104`"):
        session.begin(obs)
    assert not path.exists(), "nothing was written"


def test_the_canvases_obs_ran_are_recorded_and_the_most_seen_is_kept():
    lines = [{**LOG[0], "canvases": 1}, *LOG[1:], {**LOG[0], "canvases": 2}, {**LOG[0], "canvases": None}]
    assert onair.delivery(lines).canvases == 2
    assert onair.delivery(LOG).canvases is None, "a log from before canvases makes no claim"


# The airtime report


def label_lines() -> list[dict]:
    return [{**{k: v for k, v in line.items() if k != "deal"}, "label": "stream-1102",
             **({"source": "Webcam"} if line["kind"] == "session" else {})} for line in LOG]


def airtime(**overrides) -> dict:
    fields = dict(creator="Ada Trelawny", public_key=SIGNER.public_key, reported_at="2026-11-02T22:00:00+00:00",
                  log_sha256="a" * 64, vod_url="", platform="twitch")
    fields.update(overrides)
    return report.build_report(LABEL, onair.delivery(label_lines()), **fields)


def test_an_airtime_report_names_its_label_and_no_sponsor():
    body = airtime()
    assert body["kind"] == "airtime-report" and body["label"] == "stream-1102" and body["platform"] == "twitch"
    assert not {"dealId", "sponsor", "format"} & set(body)
    assert body["totalSeconds"] == 690 and body["sources"] == ["Webcam"]


def test_an_airtime_report_is_signed_as_a_delivery_report_is_and_its_kind_is_signed():
    body = airtime()
    signed = receipt.canonical(body)
    signature = SIGNER.sign(signed, report.NAMESPACE)
    from sponsifer import sshsig

    assert sshsig.verify(SIGNER.public_key, signature, signed, report.NAMESPACE)
    as_deal = receipt.canonical({**body, "kind": "delivery-report"})
    assert not sshsig.verify(SIGNER.public_key, signature, as_deal, report.NAMESPACE)


def test_the_airtime_notice_speaks_to_whoever_receives_it():
    text = notice_for(airtime())
    assert text.startswith("Airtime report: Ada Trelawny, stream-1102\n")
    assert "Sources watched: Webcam on twitch. No sponsor's deal; label stream-1102." in text
    assert "Twitch keeps a past broadcast for 7 days" in text
    assert "check it against the fingerprint its creator has given you" in text
    assert text.endswith("Please keep these files with the recording.")
    assert "sponsor" not in text.split("\n", 3)[2].lower().replace("no sponsor's deal", "")


def test_the_airtime_report_is_golden():
    golden = FIXTURES / "airtime-report.json"
    assert receipt.canonical(airtime()) == golden.read_bytes()


def test_more_than_one_canvas_is_signed_into_the_report_and_said_in_the_notice():
    lines = [{**LOG[0], "canvases": 2}, *LOG[1:]]
    body = build(lines)
    assert body["canvases"] == 2
    assert "OBS was running 2 canvases" in notice_for(body) and "cannot say which of the feeds" in notice_for(body)
    assert "canvases" not in build([{**LOG[0], "canvases": 1}, *LOG[1:]]), "one canvas: the document is unchanged"


# The command line


def test_a_label_needs_its_sources_named(tmp_path: Path, capsys):
    args = cli._parser().parse_args(["log", "--label", "stream-1102"])
    assert cli._log(args, tmp_path) == 1
    assert "needs --source" in capsys.readouterr().err
    assert not (tmp_path / "onair").exists(), "refused before the lock or the log"


@pytest.mark.parametrize("argv", [["log"], ["log", "dl-104", "--label", "x"], ["log", "--label", "../x"],
                                  ["report"], ["report", "dl-104", "--label", "x"]])
def test_a_log_and_a_report_are_for_a_deal_or_a_label_exactly_once(argv):
    with pytest.raises(SystemExit):
        cli._parser().parse_args(argv)


def test_the_lock_names_a_label_holder(tmp_path: Path):
    held = lock.acquire(tmp_path, onair.subject_fields(LABEL), "terminal")
    with pytest.raises(lock.Held) as refused:
        lock.acquire(tmp_path, {"deal": "dl-104"}, "app")
    assert refused.value.holder["label"] == "stream-1102"
    from sponsifer.runner import Busy

    assert Busy.held(refused.value).deal == "stream-1102"
    held.release()


def test_report_signs_a_labels_log_into_a_folder_of_its_own(tmp_path: Path, capsys, monkeypatch):
    path = onair.log_path(tmp_path, LABEL)
    for line in label_lines():
        onair.append(path, line)
    monkeypatch.setattr(keys, "signer_for", lambda home: SIGNER)
    args = cli._parser().parse_args(["report", "--label", "stream-1102", "--platform", "youtube", "--name", "Ada",
                                     "--workspace", str(tmp_path / "none.json")])
    assert cli._report(args, tmp_path) == 0
    written = sorted(p.name for p in (tmp_path / "reports" / "labels").iterdir())
    assert len(written) == 4 and all(name.startswith("stream-1102-") for name in written)
    assert not list((tmp_path / "reports").glob("*.report.json")), "nowhere a deal's reports are listed"
    record = json.loads(next((tmp_path / "reports" / "labels").glob("*Z.json")).read_text(encoding="utf-8"))
    assert record["report"]["creator"] == "Ada" and record["report"]["platform"] == "youtube"


def test_report_says_how_to_log_a_label_that_has_nothing(tmp_path: Path, capsys):
    args = cli._parser().parse_args(["report", "--label", "stream-1102"])
    assert cli._report(args, tmp_path) == 1
    assert "Run `sponsifer log --label stream-1102 --source ...`" in capsys.readouterr().err
