"""The creator's local ledger of seals, four files per serial.

`<serial>.json` is the full seal record: receipt, signature and timestamp.
The other three go to the sponsor with the delivery: `<serial>.txt`, the
notice; `<serial>.receipt.json`, the receipt as the exact bytes that were
signed and timestamped; and `<serial>.receipt.json.sig`, the OpenSSH
signature over them.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Iterator


def home_dir() -> Path:
    """Where keys and the ledger live: $SPONSIFER_HOME, or ~/.sponsifer."""
    override = os.environ.get("SPONSIFER_HOME")
    return Path(override) if override else Path.home() / ".sponsifer"


def ledger_dir(home: Path) -> Path:
    """The ledger folder under the home directory, created if missing."""
    path = home / "ledger"
    path.mkdir(parents=True, exist_ok=True)
    return path


#: A seal record's filename: the serial, ten hex characters. The sponsor's
#: `<serial>.receipt.json` sits beside it and must not be read as a record.
_RECORD = re.compile(r"^[0-9a-f]{10}\.json$")


def entries(home: Path) -> Iterator[dict[str, Any]]:
    """Every seal record in the ledger."""
    for path in sorted(ledger_dir(home).glob("*.json")):
        if _RECORD.match(path.name):
            yield json.loads(path.read_text(encoding="utf-8"))


def find_serial(home: Path, serial: str) -> dict[str, Any] | None:
    """The seal record for a serial, or None if this creator never issued it."""
    path = ledger_dir(home) / f"{serial}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def has_deal(home: Path, deal_id: str) -> bool:
    """True when any seal in the ledger belongs to this deal."""
    return any(e["receipt"]["dealId"] == deal_id for e in entries(home))


def write(home: Path, record: dict[str, Any], notice: str, signed_bytes: bytes) -> list[Path]:
    """Write a seal record and the sponsor's files. Refuses to overwrite: a serial is issued once."""
    serial = record["receipt"]["serial"]
    folder = ledger_dir(home)
    record_path = folder / f"{serial}.json"
    if record_path.exists():
        raise FileExistsError(f"serial {serial} is already in the ledger")
    record_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    sponsor = [folder / f"{serial}.txt", folder / f"{serial}.receipt.json", folder / f"{serial}.receipt.json.sig"]
    sponsor[0].write_text(notice, encoding="utf-8")
    sponsor[1].write_bytes(signed_bytes)
    sponsor[2].write_text(record["signature"], encoding="ascii")
    return sponsor
