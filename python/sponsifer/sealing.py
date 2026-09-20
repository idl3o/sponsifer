"""Sealing a deal's asset: opt-in, before delivery, once.

The order matters and is fixed. Refusals are checked before anything is
touched, including whether there is an SSH key to sign with. The creator
confirms, having been told exactly what will be bound and that one digest
will leave the machine. Then: watermark, embed the manifest, hash the
delivered file, build the receipt, sign it with the creator's SSH key,
timestamp it, write the ledger, and record the seal on the deal. If signing
or timestamping fails, the marked file is removed and nothing is recorded.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from . import __version__, keys, ledger, manifest, receipt, sshsig, workspace
from .timestamp import Stamp, Timestamper
from .watermark import Watermarker, perceptual_hash

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class SealRefused(Exception):
    """The deal or the file cannot be sealed, and why."""


@dataclass(frozen=True)
class SealPlan:
    """Everything the creator is asked to agree to, before any work is done."""

    deal: dict
    source: Path
    out: Path
    workspace_path: Path
    content_source: str

    def summary(self, tsa: str, fingerprint: str) -> str:
        terms = self.deal.get("terms", {})
        days = self.deal.get("paidUsageDays")
        window = "unlimited" if days is None else f"{days} days"
        return "\n".join(
            [
                f"Seal {self.source.name} for {self.deal.get('brand') or 'this sponsor'} ({self.deal['id']}).",
                "",
                "This will bind, permanently:",
                f"  the file        {self.source}",
                f"  usage rights    {terms.get('usageRights')}, paid usage {window}",
                f"  exclusivity     {terms.get('exclusivityDays', 0)} days",
                f"  made by         {self.content_source} (stated in the file's C2PA manifest)",
                f"  signed by       SSH key {fingerprint}",
                "",
                f"It writes a watermarked copy to {self.out}. Deliver that file, not the original.",
                "Once delivered, this deal can never be sealed again, by design.",
                "",
                f"One salted SHA-256 digest will be sent to {tsa} to be timestamped.",
                "It reveals nothing about the deal. Nothing else leaves this machine.",
            ]
        )


def plan(workspace_path: Path, deal_id: str, source: Path, out: Path | None, content_source: str, home: Path) -> SealPlan:
    """Check every refusal before anything is written or sent."""
    if content_source not in manifest.SOURCE_TYPES:
        raise SealRefused(f"--source must be one of {', '.join(manifest.SOURCE_TYPES)}")
    data = workspace.load(workspace_path)
    deal = workspace.find_deal(data, deal_id)
    reason = receipt.seal_refusal(deal, ledger.has_deal(home, deal_id))
    if reason or deal is None:
        raise SealRefused(reason or "no deal")
    if source.suffix.lower() not in IMAGE_SUFFIXES:
        raise SealRefused(
            "only still images can be sealed so far. Video needs a video watermark, which has not passed "
            "the survival test yet"
        )
    if not source.exists():
        raise SealRefused(f"{source} does not exist")
    target = out or source.with_name(f"{source.stem}.sealed{source.suffix}")
    if target.exists():
        raise SealRefused(f"{target} already exists; choose another --out")
    return SealPlan(deal, source, target, workspace_path, content_source)


@dataclass(frozen=True)
class Deps:
    """The side effects sealing needs, injected so the order can be tested."""

    watermarker: Watermarker
    timestamper: Timestamper
    signer: keys.Signer
    salt: Callable[[], bytes]
    today: str
    home: Path
    embed_manifest: bool = True


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _save(image: Image.Image, path: Path) -> None:
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        image.save(path, quality=95)
    else:
        image.save(path)


def _unused_serial(p: SealPlan, deps: Deps, master_sha: str) -> tuple[bytes, str]:
    """A salt and a serial that is usable and not yet in this creator's ledger."""
    for _ in range(16):
        salt = deps.salt()
        bits = receipt.serial_from(salt, master_sha, p.deal["id"])
        if receipt.serial_usable(bits) and ledger.find_serial(deps.home, receipt.bits_to_hex(bits)) is None:
            return salt, bits
    raise SealRefused("could not find an unused serial")  # 16 collisions in 2^40: something is wrong


def _licence_terms(p: SealPlan, serial: str) -> dict:
    terms = p.deal.get("terms", {})
    return {
        "serial": serial,
        "usageRights": terms.get("usageRights"),
        "paidUsageDays": p.deal.get("paidUsageDays"),
        "exclusivityDays": terms.get("exclusivityDays"),
    }


def _mark(p: SealPlan, deps: Deps, bits: str, creator: str) -> None:
    """Watermark, check the mark reads back, then embed the manifest."""
    marked = deps.watermarker.embed(Image.open(p.source), bits)
    staging = p.out.with_name(f".{p.out.stem}.unsigned{p.out.suffix}")
    _save(marked, staging)
    try:
        if deps.watermarker.extract(Image.open(staging)) != bits:
            raise SealRefused("the watermark did not read back from this image; it may be too flat or too small")
        if not deps.embed_manifest:
            staging.replace(p.out)
            return
        chain, key = keys.c2pa_credentials(deps.home, creator)
        body = manifest.licence_manifest(
            _licence_terms(p, receipt.bits_to_hex(bits)), title=p.out.name, source=p.content_source, version=__version__
        )
        manifest.embed(staging, p.out, body, chain, key)
    finally:
        staging.unlink(missing_ok=True)


def _sign_and_stamp(p: SealPlan, deps: Deps, signed: bytes, commit: str) -> tuple[str, Stamp]:
    """
    Sign the receipt, then timestamp its commitment. If either fails, the
    marked file is removed: a file carrying a serial that is in no ledger
    would be delivered as if it were sealed.
    """
    try:
        signature = deps.signer.sign(signed)
    except Exception as error:  # noqa: BLE001 - a cancelled passphrase must not leave a deliverable
        p.out.unlink(missing_ok=True)
        raise SealRefused(f"the receipt was not signed ({error}). Nothing was recorded") from error
    try:
        return signature, deps.timestamper(bytes.fromhex(commit))
    except Exception as error:  # noqa: BLE001 - as above
        p.out.unlink(missing_ok=True)
        raise SealRefused(f"the timestamp authority did not answer ({error}). Nothing was recorded") from error


def execute(p: SealPlan, deps: Deps, creator: str) -> dict:
    """Seal the asset. Call only after the creator has agreed to `p.summary()`."""
    master_sha = _sha256(p.source)
    salt, bits = _unused_serial(p, deps, master_sha)
    _mark(p, deps, bits, creator)

    body = receipt.build_receipt(
        p.deal,
        creator=creator,
        serial=receipt.bits_to_hex(bits),
        salt=salt,
        master_sha256=master_sha,
        sealed_sha256=_sha256(p.out),
        perceptual_hash=perceptual_hash(Image.open(p.out)),
        public_key=sshsig.normalise(deps.signer.public_key),
        sealed_on=deps.today,
    )
    signed = receipt.canonical(body)
    commit = receipt.commitment(body)
    signature, stamp = _sign_and_stamp(p, deps, signed, commit)
    record = {
        "receipt": body,
        "commitment": commit,
        "signature": signature,
        "signatureFormat": "sshsig",
        "timestamp": stamp.to_json(),
    }
    identity = keys.principal(creator)
    notice = receipt.sponsor_notice(
        body,
        fingerprint=sshsig.fingerprint(body["publicKey"]),
        allowed_signers=keys.allowed_signers_line(identity, body["publicKey"]),
        identity=identity,
        timestamped_at=stamp.time.isoformat(),
    )
    ledger.write(deps.home, record, notice, signed)
    _record_on_deal(
        p,
        {"serial": body["serial"], "commitment": commit, "sealedOn": deps.today, "timestampedAt": stamp.time.isoformat()},
    )
    return record


def _record_on_deal(p: SealPlan, summary: dict) -> None:
    """Write the seal onto the deal, without overwriting an edit the app made meanwhile."""

    def record_seal(data: dict) -> bool:
        deal = workspace.find_deal(data, p.deal["id"])
        if deal is None:
            return False
        deal["seal"] = summary
        return True

    workspace.update(p.workspace_path, record_seal)
