"""One on-air logger on this machine, whichever process runs it.

The server's runner keeps one logger at a time inside itself, but `sponsifer
log` in a terminal is another process, and so is a second server. Two loggers
watching the same conventional source names write the same minutes twice, and
a report built from either log would bill them. So every logger, and every
change to OBS's sources, first takes one lock file beside the logs.

The lock is the operating system's, held on an open file for as long as the
logger runs, so a process that dies releases it without any stale-lock rule.
A sidecar names the holder for the refusal; it is written after the lock is
taken and may be missing or out of date, so it informs a message and never
decides anything. A process is never probed by its pid: on Windows
`os.kill(pid, 0)` terminates it.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any, Literal

from .obs import utc_now

#: Beside the logs, so the lock covers exactly the place two loggers would collide.
LOCK_DIR = "onair"
LOCK_NAME = "logger.lock"
HOLDER_NAME = "logger.json"

#: Who holds the lock: a terminal's `sponsifer log`, a server's logger, or a server putting a sponsor into OBS.
By = Literal["terminal", "app", "setup"]


class Held(RuntimeError):
    """Another process holds the lock. `holder` is what it wrote about itself, or empty."""

    def __init__(self, holder: dict[str, Any]) -> None:
        super().__init__(describe(holder))
        self.holder = holder


def describe(holder: dict[str, Any]) -> str:
    """Where the other logger is, in words the creator can act on."""
    pid = holder.get("pid")
    process = f" (process {pid})" if isinstance(pid, int) else ""
    since = f", since {holder['since']}" if isinstance(holder.get("since"), str) else ""
    by = holder.get("by")
    if by == "terminal":
        return f"in a terminal{process}{since}"
    if by == "app":
        return f"in another Sponsifer server{process}{since}"
    if by == "setup":
        return f"while a sponsor is being put into OBS{process}"
    return f"in another process{process}"


@dataclass
class LoggerLock:
    """
    The held lock. Release it once; a process that exits releases it anyway.
    Keep a reference for as long as the logger runs: a discarded one is
    collected, its file closed, and the lock silently let go.
    """

    folder: Path
    handle: IO[bytes]

    def release(self) -> None:
        if self.handle.closed:
            return
        (self.folder / HOLDER_NAME).unlink(missing_ok=True)
        _unlock(self.handle)
        self.handle.close()


def acquire(home: Path, subject: dict[str, str], by: By) -> LoggerLock:
    """
    Take the machine's one logger lock, or raise `Held` naming who has it.
    `subject` is what the holder is for, such as {"deal": "dl-104"}.
    """
    folder = home / LOCK_DIR
    folder.mkdir(parents=True, exist_ok=True)
    handle = (folder / LOCK_NAME).open("a+b")  # append mode never truncates another holder's file
    try:
        _lock(handle)
    except OSError:
        handle.close()
        raise Held(_holder(folder)) from None
    holder = {"pid": os.getpid(), "by": by, "since": utc_now(), **subject}
    (folder / HOLDER_NAME).write_text(json.dumps(holder), encoding="utf-8")
    return LoggerLock(folder, handle)


def _holder(folder: Path) -> dict[str, Any]:
    try:
        holder = json.loads((folder / HOLDER_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return holder if isinstance(holder, dict) else {}


def _lock(handle: IO[bytes]) -> None:
    """Lock the file's first byte without waiting, or raise OSError."""
    if sys.platform == "win32":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock(handle: IO[bytes]) -> None:
    # Unlocked explicitly: Windows releases a lock on close only "eventually".
    if sys.platform == "win32":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
