"""The base install carries no imaging, C2PA or timestamp stack.

A streamer installs Sponsifer to put a sponsor on stream and log it. Pillow,
imagehash, c2pa-python, rfc3161ng and TrustMark come with the `seal` extra,
and only `seal` and `verify` may reach them. Run in a fresh interpreter, since
this one has already imported them for other tests.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]

#: Every module a base-install command reaches before it does any work.
BASE_MODULES = ("cli", "api", "serve", "runner", "obs", "obs_setup", "onair", "report", "workspace",
                "keys", "sshsig", "receipt", "ledger", "manifest", "brand", "timestamp", "lock",
                "status", "client", "toolkit")

#: Import names the `seal` extra provides, and what they pull in.
SEAL_ONLY = ("PIL", "imagehash", "c2pa", "rfc3161ng", "pyasn1", "trustmark", "torch", "numpy")

PROBE = f"""
import importlib, json, sys
for name in {BASE_MODULES!r}:
    importlib.import_module("sponsifer." + name)
from sponsifer import cli
cli._parser()
print(json.dumps(sorted(m for m in sys.modules if m.split(".")[0] in {SEAL_ONLY!r})))
"""


def test_the_base_commands_import_nothing_from_the_seal_extra():
    env = {**os.environ, "PYTHONPATH": str(PYTHON_DIR)}
    done = subprocess.run([sys.executable, "-c", PROBE], capture_output=True, text=True, check=True, env=env)
    assert json.loads(done.stdout) == []
