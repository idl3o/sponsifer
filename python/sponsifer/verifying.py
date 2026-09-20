"""Checking a sighting: is this running ad a sealed asset, and on what terms?

`verify` reports facts and prices nothing. The overrun invoice is composed in
the web app from benchmarks.ts, so market assumptions stay in one file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable, Literal

from PIL import Image

from . import ledger, manifest, receipt, sshsig, workspace
from .timestamp import Stamp, token_time, token_valid
from .watermark import RESEMBLANCE, Watermarker, hash_distance, perceptual_hash


@dataclass(frozen=True)
class Finding:
    """What a downloaded ad shows."""

    kind: Literal["no-mark", "unknown-serial", "claim"]
    serial: str | None = None
    deal_id: str | None = None
    claim: receipt.Claim | None = None
    #: Ledger serials whose sealed file this looks like, with pHash distance.
    resembles: list[tuple[str, int]] = field(default_factory=list)
    #: The licence from a surviving C2PA manifest, if the pipeline kept one.
    manifest_licence: dict | None = None


def _resemblances(home: Path, image: Image.Image) -> list[tuple[str, int]]:
    found = perceptual_hash(image)
    near = [(e["receipt"]["serial"], hash_distance(found, e["receipt"]["perceptualHash"])) for e in ledger.entries(home)]
    return sorted((s, d) for s, d in near if d <= RESEMBLANCE)


#: Checks a stored timestamp against a digest: (token valid, date it asserts).
StampCheck = Callable[[Stamp, bytes], tuple[bool, date]]


def real_stamp_check(stamp: Stamp, digest: bytes) -> tuple[bool, date]:
    """Read the time from the token itself, never from the stored copy beside it."""
    return token_valid(stamp.token, digest), token_time(stamp.token).date()


def verify(
    path: Path,
    started_on: date,
    seen_on: date,
    watermarker: Watermarker,
    home: Path,
    stamp_check: StampCheck = real_stamp_check,
) -> Finding:
    """Decode, look up, and apply every rule. Writes nothing."""
    image = Image.open(path)
    licence = manifest.read_licence(path)
    bits = watermarker.extract(image)
    if bits is None:
        # Absence proves nothing: the mark may have been stripped, or never there.
        return Finding("no-mark", resembles=_resemblances(home, image), manifest_licence=licence)

    serial = receipt.bits_to_hex(bits)
    entry = ledger.find_serial(home, serial)
    if entry is None:
        return Finding("unknown-serial", serial=serial, manifest_licence=licence)

    body, commit = entry["receipt"], entry["commitment"]
    digest = bytes.fromhex(commit)
    stamp_ok, stamped_on = stamp_check(Stamp.from_json(entry["timestamp"]), digest)
    claim = receipt.assess_claim(
        body,
        commitment_ok=receipt.commitment(body) == commit,
        signature_ok=sshsig.verify(body["publicKey"], entry["signature"], receipt.canonical(body)),
        timestamp_ok=stamp_ok,
        timestamped_on=stamped_on,
        started_on=started_on,
        seen_on=seen_on,
    )
    return Finding("claim", serial=serial, deal_id=body["dealId"], claim=claim, manifest_licence=licence)


def record_sighting(workspace_path: Path, finding: Finding, started_on: date, seen_on: date, source: str) -> bool:
    """Add a verified sighting to the deal. Only a claim that holds is recorded."""
    if finding.kind != "claim" or finding.claim is None or not finding.claim.holds or finding.serial is None:
        return False
    serial = finding.serial

    def add(data: dict) -> bool:
        deal = workspace.find_by_serial(data, serial)
        if deal is None:
            return False
        sightings = deal.setdefault("sightings", [])
        sightings.append(
            {
                "id": f"st-verify-{serial}-{len(sightings) + 1}",
                "source": source,
                "startedOn": started_on.isoformat(),
                "seenOn": seen_on.isoformat(),
                "verified": True,
            }
        )
        return True

    return workspace.update(workspace_path, add)
