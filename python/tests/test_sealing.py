"""Seal and verify end to end, with the watermark and the network faked.

The fake watermark hides a preamble and the serial in the red channel's low
bits. It survives a lossless save and nothing else, which is all these tests
need: they test the order of operations and the rules, not TrustMark.
"""

import dataclasses
import json
import shutil
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image, ImageDraw

from sponsifer import ledger, manifest, sealing
from sponsifer.keys import Ed25519Signer
from sponsifer.timestamp import Stamp
from sponsifer.verifying import record_sighting, verify

PREAMBLE = "10110010"
SEALED_AT = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)


class LsbWatermarker:
    def embed(self, image, bits):
        out = image.convert("RGB").copy()
        px = out.load()
        for i, bit in enumerate(PREAMBLE + bits):
            r, g, b = px[i, 0]
            px[i, 0] = ((r & ~1) | int(bit), g, b)
        return out

    def extract(self, image):
        px = image.convert("RGB").load()
        bits = "".join(str(px[i, 0][0] & 1) for i in range(len(PREAMBLE) + 40))
        return bits[len(PREAMBLE):] if bits.startswith(PREAMBLE) else None


def fake_stamp(digest):
    return Stamp("fake-tsa", b"token:" + digest, SEALED_AT)


def fake_check(stamp, digest):
    return stamp.token == b"token:" + digest, stamp.time.date()


@pytest.fixture
def setup(tmp_path: Path):
    image = Image.new("RGB", (320, 180), (40, 90, 160))
    ImageDraw.Draw(image).ellipse([60, 40, 200, 150], fill=(210, 150, 60))
    asset = tmp_path / "asset.png"
    image.save(asset)
    deal = {
        "id": "dl-104", "prospectId": "pr-2", "brand": "Hetzner", "outcome": "won", "lostReason": None,
        "closedOn": "2026-09-10", "platform": "youtube", "format": "integration",
        "terms": {"usageRights": "whitelisting-30", "exclusivityDays": 0, "revisions": 1, "rush": False, "bundleSize": 1},
        "paidUsageDays": 30, "deliveredOn": "", "paidOn": "", "seal": None, "sightings": [], "notes": "",
    }
    ws = tmp_path / "sponsifer.json"
    ws.write_text(json.dumps({"version": 2, "profile": {"name": "Ada Trelawny"}, "deals": [deal]}), encoding="utf-8")
    home = tmp_path / "home"
    counter = iter(range(1, 1000))
    signer = Ed25519Signer(Ed25519PrivateKey.from_private_bytes(bytes(range(32))))
    deps = sealing.Deps(LsbWatermarker(), fake_stamp, signer, lambda: bytes([next(counter)]) * 16, "2026-09-10",
                        home, embed_manifest=False)
    return tmp_path, asset, ws, home, deps


def seal(setup, **kw):
    _, asset, ws, home, deps = setup
    plan = sealing.plan(ws, "dl-104", asset, None, kw.get("source", "capture"), home)
    return plan, sealing.execute(plan, kw.get("deps", deps), "Ada Trelawny")


def test_seal_writes_the_file_the_ledger_and_the_deal(setup):
    tmp, _, ws, home, _ = setup
    plan, record = seal(setup)
    serial = record["receipt"]["serial"]
    assert plan.out.exists()
    assert (ledger.ledger_dir(home) / f"{serial}.txt").read_text(encoding="utf-8").startswith("Licence receipt")
    assert json.loads(ws.read_text(encoding="utf-8"))["deals"][0]["seal"]["serial"] == serial


def test_the_delivered_file_is_the_one_the_receipt_names(setup):
    import hashlib

    plan, record = seal(setup)
    assert hashlib.sha256(plan.out.read_bytes()).hexdigest() == record["receipt"]["sealedSha256"]


def test_a_deal_cannot_be_sealed_twice(setup):
    seal(setup)
    _, asset, ws, home, _ = setup
    with pytest.raises(sealing.SealRefused, match="already sealed"):
        sealing.plan(ws, "dl-104", asset, asset.with_name("again.png"), "capture", home)


def test_a_delivered_deal_cannot_be_sealed_and_nothing_is_written(setup):
    tmp, asset, ws, home, _ = setup
    data = json.loads(ws.read_text(encoding="utf-8"))
    data["deals"][0]["deliveredOn"] = "2026-09-12"
    ws.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(sealing.SealRefused, match="before delivery"):
        sealing.plan(ws, "dl-104", asset, None, "capture", home)
    assert not asset.with_name("asset.sealed.png").exists()


def test_video_is_refused_until_a_video_mark_passes_survival(setup):
    tmp, _, ws, home, _ = setup
    clip = tmp / "clip.mp4"
    clip.write_bytes(b"\0")
    with pytest.raises(sealing.SealRefused, match="still images"):
        sealing.plan(ws, "dl-104", clip, None, "capture", home)


def test_a_failed_timestamp_leaves_no_deliverable_and_no_record(setup):
    tmp, asset, ws, home, deps = setup

    def offline(_digest):
        raise ConnectionError("offline")

    broken = dataclasses.replace(deps, timestamper=offline)
    plan = sealing.plan(ws, "dl-104", asset, None, "capture", home)
    with pytest.raises(sealing.SealRefused, match="Nothing was recorded"):
        sealing.execute(plan, broken, "Ada Trelawny")
    assert not plan.out.exists()
    assert list(ledger.entries(home)) == []
    assert json.loads(ws.read_text(encoding="utf-8"))["deals"][0]["seal"] is None


def test_a_cancelled_passphrase_leaves_no_deliverable_and_no_record(setup):
    tmp, asset, ws, home, deps = setup

    class Cancelled:
        public_key = deps.signer.public_key

        def sign(self, message):
            raise RuntimeError("passphrase prompt cancelled")

    plan = sealing.plan(ws, "dl-104", asset, None, "capture", home)
    with pytest.raises(sealing.SealRefused, match="not signed"):
        sealing.execute(plan, dataclasses.replace(deps, signer=Cancelled()), "Ada Trelawny")
    assert not plan.out.exists()
    assert list(ledger.entries(home)) == []


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="ssh-keygen not installed")
def test_the_sponsor_can_verify_the_receipt_with_openssh_alone(setup):
    """Run the exact command the notice gives the sponsor, on the files the seal wrote."""
    tmp, _, _, home, _ = setup
    _, record = seal(setup)
    serial = record["receipt"]["serial"]
    folder = ledger.ledger_dir(home)
    notice = (folder / f"{serial}.txt").read_text(encoding="utf-8").splitlines()
    signers_line = notice[notice.index("To check the signature with nothing but OpenSSH, save this line as allowed_signers:") + 1]
    (folder / "allowed_signers").write_text(signers_line.strip() + "\n", encoding="ascii")
    result = subprocess.run(
        ["ssh-keygen", "-Y", "verify", "-f", "allowed_signers", "-I", "ada-trelawny", "-n", "sponsifer-receipt",
         "-s", f"{serial}.receipt.json.sig"],
        input=(folder / f"{serial}.receipt.json").read_bytes(), capture_output=True, cwd=folder,
    )
    assert result.returncode == 0, result.stderr.decode()
    assert b"Good" in result.stdout + result.stderr


def test_the_c2pa_manifest_carries_the_licence(setup):
    tmp, asset, ws, home, deps = setup
    with_c2pa = dataclasses.replace(deps, embed_manifest=True)
    plan, record = seal(setup, deps=with_c2pa, source="ai-composite")
    licence = manifest.read_licence(plan.out)
    assert licence is not None and licence["serial"] == record["receipt"]["serial"]
    assert licence["paidUsageDays"] == 30


def active_manifest(path: Path) -> tuple[dict, dict]:
    import c2pa

    data = json.loads(c2pa.Reader(str(path)).json())
    return data, data["manifests"][data["active_manifest"]]


def test_the_manifest_binds_the_watermark_it_declares(setup):
    """
    From c2pa-python 0.37.12, c2pa refuses to sign a watermarked action with no
    soft binding, which broke every seal with a manifest; this is the binding.
    """
    import base64

    from sponsifer import receipt

    _, _, _, _, deps = setup
    plan, record = seal(setup, deps=dataclasses.replace(deps, embed_manifest=True))
    data, active = active_manifest(plan.out)
    by_label = {a["label"]: a["data"] for a in active["assertions"]}
    actions = [a["action"] for a in by_label["c2pa.actions.v2"]["actions"]]
    assert actions == ["c2pa.created", "c2pa.watermarked.bound"]
    binding = by_label["c2pa.soft-binding"]
    assert binding["alg"] == "com.adobe.trustmark.Q"
    [block] = binding["blocks"]
    bits = receipt.hex_to_bits(record["receipt"]["serial"])
    assert block["scope"] == {} and base64.b64decode(block["value"]) == f"0*{bits}".encode()
    failures = [s["code"] for s in data.get("validation_status") or [] if s["code"] != "signingCredential.untrusted"]
    assert failures == [], "the self-signed chain is the only thing a validator may object to"


def test_the_binding_names_the_registered_algorithm_and_trustmarks_own_value_format():
    """com.adobe.trustmark.Q is variant Q's entry on the C2PA soft-binding algorithm list; the value is
    '<schema>*<bits>', as adobe/trustmark's c2pa/c2pa_watermark_example.py writes it."""
    from sponsifer import watermark

    assert watermark.SOFT_BINDING_ALG == "com.adobe.trustmark.Q"
    assert watermark.soft_binding_value("01" * 20) == b"0*" + b"01" * 20
    body = manifest.licence_manifest({}, title="t", source="capture", version="0",
                                     binding=manifest.SoftBinding("com.adobe.trustmark.Q", b"0*1"))
    [binding] = [a["data"] for a in body["assertions"] if a["label"] == "c2pa.soft-binding"]
    assert binding == {"alg": "com.adobe.trustmark.Q", "blocks": [{"scope": {}, "value": [48, 42, 49]}]}


def test_verify_holds_a_sighting_that_started_after_the_seal(setup):
    tmp, _, ws, home, deps = setup
    plan, record = seal(setup)
    finding = verify(plan.out, date(2026, 10, 1), date(2026, 12, 15), deps.watermarker, home, fake_check)
    assert finding.kind == "claim" and finding.claim.holds
    assert finding.claim.overrun_days == 45
    assert record_sighting(ws, finding, date(2026, 10, 1), date(2026, 12, 15), "ad library")
    sighting = json.loads(ws.read_text(encoding="utf-8"))["deals"][0]["sightings"][0]
    assert sighting["verified"] is True


def test_verify_refuses_an_ad_that_started_before_the_seal(setup):
    """The retroactive case: the ad was already running when the seal was made."""
    tmp, _, ws, home, deps = setup
    plan, _ = seal(setup)
    finding = verify(plan.out, date(2026, 9, 1), date(2026, 12, 15), deps.watermarker, home, fake_check)
    assert finding.kind == "claim" and not finding.claim.holds
    assert not record_sighting(ws, finding, date(2026, 9, 1), date(2026, 12, 15), "")


def test_a_stripped_mark_is_reported_as_resemblance_not_evidence(setup):
    tmp, _, ws, home, deps = setup
    plan, record = seal(setup)
    stripped = Image.open(plan.out).convert("RGB")
    px = stripped.load()
    for i in range(48):
        r, g, b = px[i, 0]
        px[i, 0] = (r & ~1, g, b)
    path = tmp / "stripped.png"
    stripped.save(path)
    finding = verify(path, date(2026, 10, 1), date(2026, 12, 15), deps.watermarker, home, fake_check)
    assert finding.kind == "no-mark"
    assert finding.resembles and finding.resembles[0][0] == record["receipt"]["serial"]
    assert not record_sighting(ws, finding, date(2026, 10, 1), date(2026, 12, 15), "")
