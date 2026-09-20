"""The licence receipt, its commitment, and the rules a claim must pass.

Pure: no clock, no randomness, no I/O. Everything that touches the world is
passed in, so the rules that make sealing non-retroactive can be tested
directly. See docs/provenance.md for why each rule exists.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from .sshsig import NAMESPACE

RECEIPT_VERSION = 1

#: Bits of watermark payload. TrustMark's most robust schema carries 40, and a
#: 40-bit serial is a pointer, not a commitment: collisions matter only within
#: one creator's ledger, which is checked at sealing time.
SERIAL_BITS = 40

#: Serials the decoder can produce from degenerate input. Never issued.
_DEGENERATE = {"0" * SERIAL_BITS, "1" * SERIAL_BITS}


def canonical(value: Any) -> bytes:
    """Deterministic JSON: sorted keys, no whitespace, UTF-8."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def commitment(receipt: dict[str, Any]) -> str:
    """SHA-256 of the canonical receipt, hex. This is what is signed and timestamped."""
    return hashlib.sha256(canonical(receipt)).hexdigest()


def serial_from(salt: bytes, master_sha256: str, deal_id: str) -> str:
    """Derive a serial, as a bit string, from the salt and what is being sealed."""
    digest = hashlib.sha256(salt + master_sha256.encode() + deal_id.encode()).digest()
    return "".join(f"{byte:08b}" for byte in digest)[:SERIAL_BITS]


def serial_usable(bits: str) -> bool:
    """False for a serial of the wrong length or one a degenerate decode could produce."""
    return len(bits) == SERIAL_BITS and set(bits) <= {"0", "1"} and bits not in _DEGENERATE


def bits_to_hex(bits: str) -> str:
    """A 40-bit serial as ten hex characters, which is how people read it."""
    return f"{int(bits, 2):0{SERIAL_BITS // 4}x}"


def hex_to_bits(serial: str) -> str:
    """Inverse of `bits_to_hex`."""
    return f"{int(serial, 16):0{SERIAL_BITS}b}"


def seal_refusal(deal: dict[str, Any] | None, already_in_ledger: bool) -> str | None:
    """
    Why this deal cannot be sealed, or None if it can.

    These refusals catch mistakes. They are not what makes sealing
    non-retroactive: the creator controls this code. The evidence rules in
    `assess_claim` are what hold.
    """
    if deal is None:
        return "no deal with that id in the workspace file"
    if deal.get("outcome") != "won":
        return "only a won deal has terms to establish"
    if deal.get("deliveredOn"):
        return (
            f"this deal was delivered on {deal['deliveredOn']}. Sealing must happen before delivery, "
            "and there is deliberately no way round that"
        )
    if deal.get("seal") or already_in_ledger:
        return "this deal is already sealed"
    return None


def build_receipt(
    deal: dict[str, Any],
    *,
    creator: str,
    serial: str,
    salt: bytes,
    master_sha256: str,
    sealed_sha256: str,
    perceptual_hash: str,
    public_key: str,
    sealed_on: str,
) -> dict[str, Any]:
    """Assemble the receipt for a deal. Every field is a fact the sponsor can check."""
    terms = deal.get("terms", {})
    return {
        "version": RECEIPT_VERSION,
        "serial": serial,
        "salt": salt.hex(),
        "dealId": deal["id"],
        "creator": creator,
        "sponsor": deal.get("brand", ""),
        "platform": deal["platform"],
        "format": deal["format"],
        "usageRights": terms.get("usageRights", "organic-only"),
        "paidUsageDays": deal.get("paidUsageDays", 0),
        "exclusivityDays": terms.get("exclusivityDays", 0),
        "grantedOn": deal["closedOn"],
        "sealedOn": sealed_on,
        "masterSha256": master_sha256,
        "sealedSha256": sealed_sha256,
        "perceptualHash": perceptual_hash,
        "publicKey": public_key,
    }


@dataclass(frozen=True)
class Claim:
    """What a sighting shows, once every rule has been applied."""

    holds: bool
    #: Every rule, in order, with whether it passed and why.
    checks: tuple[tuple[str, bool, str], ...]
    days_run: int
    permitted: int | None
    overrun_days: int


def _permitted_text(permitted: int | None) -> str:
    if permitted is None:
        return "unlimited paid usage"
    if permitted == 0:
        return "no paid usage at all"
    return f"{permitted} days of paid usage"


def assess_claim(
    receipt: dict[str, Any],
    *,
    commitment_ok: bool,
    signature_ok: bool,
    timestamp_ok: bool,
    timestamped_on: date,
    started_on: date,
    seen_on: date,
) -> Claim:
    """
    Apply the rules that make a sighting evidence.

    The watermark having decoded to this receipt's serial is the caller's
    precondition. The rest is here: the receipt is the one that was committed
    to, the creator signed it, a timestamp authority saw it, and it saw it
    before the ad started running. That last rule is the one that makes
    sealing non-retroactive.
    """
    before = timestamped_on < started_on
    checks = (
        ("receipt matches its commitment", commitment_ok, "the terms are exactly those that were timestamped"),
        ("creator's signature", signature_ok, "an OpenSSH signature by the key named in the receipt"),
        ("timestamp token", timestamp_ok, "issued by the timestamp authority over this commitment"),
        (
            "sealed before the ad ran",
            before,
            f"timestamped {timestamped_on.isoformat()}, ad started {started_on.isoformat()}"
            if before
            else f"timestamped {timestamped_on.isoformat()}, not before the ad started "
            f"{started_on.isoformat()}, so this seal says nothing about this ad",
        ),
    )
    days_run = max(0, (seen_on - started_on).days)
    permitted = receipt.get("paidUsageDays")
    overrun = 0 if permitted is None else max(0, days_run - permitted)
    return Claim(
        holds=all(ok for _, ok, _ in checks),
        checks=checks,
        days_run=days_run,
        permitted=permitted,
        overrun_days=overrun,
    )


def sponsor_notice(
    receipt: dict[str, Any], *, fingerprint: str, allowed_signers: str, identity: str, timestamped_at: str
) -> str:
    """
    The plain-text receipt the sponsor receives with the delivery.

    It says the file is marked and what the mark records, because deterrence
    only works when the sponsor knows, and a hidden mark found later damages
    the relationship it was meant to protect. It also tells the sponsor how
    to check the signature with OpenSSH alone, because a receipt the other
    party cannot verify without the creator's software is worth less.
    """
    serial = receipt["serial"]
    return "\n".join(
        [
            f"Licence receipt: {receipt['creator']} to {receipt['sponsor']}",
            "",
            f"Asset: {receipt['format']} for {receipt['platform']}, delivered as the file with SHA-256",
            f"  {receipt['sealedSha256']}",
            f"Usage granted: {receipt['usageRights']}, {_permitted_text(receipt['paidUsageDays'])}, "
            "counted from the first paid run.",
            f"Category exclusivity: {receipt['exclusivityDays']} days.",
            f"Granted on {receipt['grantedOn']}.",
            "",
            f"This file carries an invisible watermark holding serial {serial}, which identifies",
            "this receipt. It records nothing else.",
            "",
            f"The signed receipt is {serial}.receipt.json, with its signature in {serial}.receipt.json.sig.",
            f"Its SHA-256, {commitment(receipt)},",
            f"was timestamped by an RFC 3161 authority at {timestamped_at}.",
            f"It is signed with the SSH key {fingerprint}, the fingerprint in our agreement.",
            "",
            "To check the signature with nothing but OpenSSH, save this line as allowed_signers:",
            f"  {allowed_signers}",
            "and run:",
            f"  ssh-keygen -Y verify -f allowed_signers -I {identity} -n {NAMESPACE} \\",
            f"    -s {serial}.receipt.json.sig < {serial}.receipt.json",
            "",
            "Please keep these files with the contract.",
        ]
    )
