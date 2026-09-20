"""Reading and writing the workspace file.

The file under the home directory is the source of truth: the local server
serves it to the app and the overlay, and the CLI writes into it. The CLI
touches only what it owns: a deal's `seal` and its `sightings`. Every other
field passes through untouched.

Every write is atomic, so a crash mid-write cannot leave half a workspace, and
can be a compare-and-swap on the file's revision, a hash of its bytes. A
content hash needs no coordination between processes: whoever wrote last, the
bytes on disk say which version is current.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

#: The newest workspace format this CLI understands. Mirrors WORKSPACE_VERSION.
SUPPORTED_VERSION = 5
#: The first format with a deal log, which is all the CLI reads.
FIRST_WITH_DEALS = 2
#: The revision of a file that does not exist. No SHA-256 digest can equal it.
ABSENT = "absent"


class Changed(Exception):
    """The file changed after it was read, so writing would lose someone's edit."""


def default_path(home: Path) -> Path:
    """The workspace the server serves: beside the ledger and the keys."""
    return home / "workspace.json"


def revision(raw: bytes) -> str:
    """A file's revision: the SHA-256 of its bytes, in hex."""
    return hashlib.sha256(raw).hexdigest()


def current_revision(path: Path) -> str:
    """The revision on disk now, or ABSENT."""
    try:
        return revision(path.read_bytes())
    except FileNotFoundError:
        return ABSENT


def load(path: Path) -> dict[str, Any]:
    """Read a workspace file, refusing a format this CLI does not understand."""
    return check(json.loads(path.read_text(encoding="utf-8")), path)


def check(data: Any, path: Path) -> dict[str, Any]:
    """Refuse a workspace from a format this CLI cannot read."""
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a workspace")
    version = data.get("version", 1)
    if version > SUPPORTED_VERSION:
        raise ValueError(f"{path} is workspace format {version}; this CLI understands up to {SUPPORTED_VERSION}")
    if version < FIRST_WITH_DEALS:
        raise ValueError(f"{path} predates the deal log. Import it into the app and export it again")
    return data


def find_deal(data: dict[str, Any], deal_id: str) -> dict[str, Any] | None:
    """The deal with this id, or None."""
    return next((d for d in data.get("deals", []) if d.get("id") == deal_id), None)


def find_by_serial(data: dict[str, Any], serial: str) -> dict[str, Any] | None:
    """The deal sealed under this serial, or None."""
    return next((d for d in data.get("deals", []) if (d.get("seal") or {}).get("serial") == serial), None)


def encode(data: dict[str, Any]) -> bytes:
    """The bytes a workspace is saved as, so its revision can be known before it is written."""
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def save(path: Path, data: dict[str, Any], expected: str | None = None) -> str:
    """
    Replace the file atomically and return its new revision.

    With `expected`, the write happens only if the file is still at that
    revision (ABSENT: only if there is no file), and raises Changed otherwise.
    Between the check and the replace another process can still write; the
    window is the length of one small write, and the next save will see it.
    """
    if expected is not None and current_revision(path) != expected:
        raise Changed(f"{path} changed after it was read")
    raw = encode(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".workspace-", suffix=".json")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        _replace(Path(tmp), path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return revision(raw)


def _replace(source: Path, target: Path, attempts: int = 5) -> None:
    """os.replace, retried briefly: on Windows it fails while another process holds the file open."""
    for attempt in range(attempts):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05)


def update(path: Path, change: Callable[[dict[str, Any]], bool], attempts: int = 3) -> bool:
    """
    Read, change and save the workspace without overwriting an edit made meanwhile.

    `change` edits the data in place and returns whether anything changed. If
    the file moves under it, the whole read-change-save runs again on the new
    file, which is safe because the CLI's changes are functions of the deal.
    """
    for attempt in range(attempts):
        raw = path.read_bytes()
        data = check(json.loads(raw.decode("utf-8")), path)
        before = revision(raw)
        if not change(data):
            return False
        try:
            save(path, data, expected=before)
            return True
        except Changed:
            if attempt == attempts - 1:
                raise
    return False
