"""The delivery report: an index into the recording, signed under its own namespace."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from sponsifable import onair, receipt, report, sshsig
from sponsifable.keys import Ed25519Signer, allowed_signers_line

DEAL = {"id": "dl-104", "brand": "Hetzner", "outcome": "won", "platform": "twitch", "format": "stream",
        "agreed": 400, "quoted": 450}

LOG = [
    {"kind": "session", "at": "2026-09-18T20:00:00.000+00:00", "deal": "dl-104", "source": "Sponsor overlay"},
    {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True},
    {"kind": "onair", "at": "2026-09-18T20:05:00.000+00:00", "state": "start"},
    {"kind": "disagreement", "at": "2026-09-18T20:06:00.000+00:00", "live": True, "active": True},
    {"kind": "onair", "at": "2026-09-18T20:06:30.000+00:00", "state": "end"},
    {"kind": "onair", "at": "2026-09-18T21:00:00.000+00:00", "state": "start"},
    {"kind": "onair", "at": "2026-09-18T21:10:00.000+00:00", "state": "end"},
]

SIGNER = Ed25519Signer(Ed25519PrivateKey.from_private_bytes(bytes(range(32))))


def build(lines=LOG, **overrides):
    fields = dict(creator="Ada Trelawny", public_key=SIGNER.public_key, reported_at="2026-09-18T22:00:00+00:00",
                  log_sha256="a" * 64, vod_url="https://www.twitch.tv/videos/1")
    fields.update(overrides)
    return report.build_report(DEAL, onair.delivery(lines), **fields)


def test_the_report_is_the_log_folded_and_nothing_else():
    body = build()
    assert body["totalSeconds"] == 690
    assert [i["streamOffsetSeconds"] for i in body["intervals"]] == [300, 3600]
    assert body["disagreements"] == 1
    assert body["sponsor"] == "Hetzner"


def test_a_deal_with_one_placement_gets_no_breakdown():
    assert "By placement:" not in notice_for(build())
    assert build()["version"] == 2


def test_several_placements_are_each_given_their_own_total():
    at = "2026-09-18T20:%s:00.000+00:00"
    lines = [
        {"kind": "session", "at": at % "00", "deal": "dl-104", "sources": ["Sponsor overlay", "Sponsor slate"]},
        {"kind": "stream", "at": at % "00", "live": True, "startObserved": True},
        {"kind": "onair", "at": at % "00", "source": "Sponsor overlay", "state": "start"},
        {"kind": "onair", "at": at % "10", "source": "Sponsor slate", "state": "start"},
        {"kind": "onair", "at": at % "12", "source": "Sponsor slate", "state": "end"},
        {"kind": "onair", "at": at % "30", "source": "Sponsor overlay", "state": "end"},
    ]
    text = notice_for(build(lines))
    assert "On air for 30m 00s in total" in text
    assert '"Sponsor overlay": 30m 00s across 1 interval' in text
    assert '"Sponsor slate": 2m 00s across 1 interval' in text
    assert "counts a moment once" in text


def test_the_report_carries_no_price():
    body = build()
    flat = json.dumps(body).lower()
    for word in ("agreed", "quoted", "price", "fee", "£", "gbp"):
        assert word not in flat, word


def test_the_same_inputs_give_the_same_bytes():
    assert receipt.canonical(build()) == receipt.canonical(build())
    assert report.commitment(build()) != report.commitment(build(log_sha256="b" * 64))


def test_signed_under_its_own_namespace_and_not_verifiable_as_a_receipt():
    body = build()
    signed = receipt.canonical(body)
    signature = SIGNER.sign(signed, report.NAMESPACE)
    assert sshsig.verify(SIGNER.public_key, signature, signed, report.NAMESPACE)
    # A delivery signature is not a receipt signature, and the reverse.
    assert not sshsig.verify(SIGNER.public_key, signature, signed, sshsig.NAMESPACE)
    as_receipt = SIGNER.sign(signed)
    assert not sshsig.verify(SIGNER.public_key, as_receipt, signed, report.NAMESPACE)


def notice_for(body):
    identity = "ada-trelawny"
    return report.sponsor_notice(
        body,
        fingerprint=sshsig.fingerprint(body["publicKey"]),
        allowed_signers=allowed_signers_line(identity, body["publicKey"], report.NAMESPACE),
        identity=identity,
    )


def test_the_notice_says_where_to_look_and_that_the_recording_is_the_evidence():
    text = notice_for(build())
    assert "0:05:00 into the stream" in text
    assert "1:00:00 into the stream" in text
    assert "11m 30s in total" in text
    assert "not proof on its own" in text
    assert "https://www.twitch.tv/videos/1" in text
    assert "7 days" in text  # Twitch retention, so the sponsor checks in time


def test_the_notice_hides_neither_disagreements_nor_an_open_interval():
    text = notice_for(build())
    assert "1 time the logger's direct check of OBS contradicted" in text
    left_open = LOG + [{"kind": "onair", "at": "2026-09-18T22:00:00.000+00:00", "state": "start"}]
    assert "stopped while the placement was still on air" in notice_for(build(left_open))


def test_the_notice_says_when_offsets_are_unknown():
    joined_late = [dict(line, startObserved=False) if line["kind"] == "stream" else line for line in LOG]
    text = notice_for(build(joined_late))
    assert "offset unknown" in text
    assert "joined after the stream began" in text


def test_the_notice_tells_the_sponsor_how_to_verify_without_this_software():
    text = notice_for(build())
    assert f"-n {report.NAMESPACE}" in text
    assert 'namespaces="sponsifable-delivery"' in text
    assert "ssh-keygen -Y verify" in text


def test_write_lays_out_the_sponsor_files_and_refuses_to_overwrite(tmp_path: Path):
    body = build()
    signed = receipt.canonical(body)
    signature = SIGNER.sign(signed, report.NAMESPACE)
    paths = report.write(tmp_path, body, signature, "notice", signed)
    assert [p.name for p in paths] == [
        "dl-104-20260918T220000Z.txt",
        "dl-104-20260918T220000Z.report.json",
        "dl-104-20260918T220000Z.report.json.sig",
    ]
    assert paths[1].read_bytes() == signed
    assert (tmp_path / "reports" / "dl-104-20260918T220000Z.json").exists()
    with pytest.raises(FileExistsError):
        report.write(tmp_path, body, signature, "notice", signed)


ssh_keygen = shutil.which("ssh-keygen")


@pytest.mark.skipif(ssh_keygen is None, reason="ssh-keygen not installed")
def test_openssh_verifies_a_report_under_the_delivery_namespace(tmp_path: Path):
    body = build()
    signed = receipt.canonical(body)
    (tmp_path / "r.json").write_bytes(signed)
    (tmp_path / "r.json.sig").write_text(SIGNER.sign(signed, report.NAMESPACE), encoding="ascii")
    (tmp_path / "allowed_signers").write_text(
        allowed_signers_line("ada-trelawny", SIGNER.public_key, report.NAMESPACE) + "\n", encoding="ascii")
    result = subprocess.run(
        [ssh_keygen, "-Y", "verify", "-f", str(tmp_path / "allowed_signers"), "-I", "ada-trelawny",
         "-n", report.NAMESPACE, "-s", str(tmp_path / "r.json.sig")],
        input=signed, capture_output=True,
    )
    assert result.returncode == 0, result.stderr.decode()
    # And the same signature is refused under the receipt namespace.
    refused = subprocess.run(
        [ssh_keygen, "-Y", "verify", "-f", str(tmp_path / "allowed_signers"), "-I", "ada-trelawny",
         "-n", sshsig.NAMESPACE, "-s", str(tmp_path / "r.json.sig")],
        input=signed, capture_output=True,
    )
    assert refused.returncode != 0
