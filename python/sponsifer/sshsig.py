"""OpenSSH signatures (SSHSIG), the format `ssh-keygen -Y sign` writes.

Receipts are signed with the creator's SSH key, so a sponsor can check one
with `ssh-keygen -Y verify`, which ships with Windows, macOS and Linux, and
needs nothing from this project. The format is OpenSSH's PROTOCOL.sshsig.

Ed25519 signatures are produced and checked here directly. Other key types,
including hardware-backed `sk-` keys, are signed by ssh-keygen and checked by
it too.
"""

from __future__ import annotations

import base64
import hashlib
import shutil
import struct
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

#: Every receipt signature is made in this namespace, so a signature over a
#: receipt can never be replayed as a signature over anything else.
NAMESPACE = "sponsifer-receipt"

_MAGIC = b"SSHSIG"
_VERSION = 1
_BEGIN, _END = "-----BEGIN SSH SIGNATURE-----", "-----END SSH SIGNATURE-----"


def _string(data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + data


class _Reader:
    """Reads SSH wire-format fields in order."""

    def __init__(self, data: bytes) -> None:
        self.data, self.pos = data, 0

    def raw(self, n: int) -> bytes:
        """The next n bytes."""
        if self.pos + n > len(self.data):
            raise ValueError("truncated SSH structure")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def uint32(self) -> int:
        """The next big-endian 32-bit unsigned integer."""
        return struct.unpack(">I", self.raw(4))[0]

    def string(self) -> bytes:
        """The next length-prefixed byte string."""
        return self.raw(self.uint32())


def key_blob(public_key: str) -> bytes:
    """The wire-format blob of an OpenSSH public key line ("type base64 [comment]")."""
    parts = public_key.split()
    if len(parts) < 2:
        raise ValueError("not an OpenSSH public key line")
    blob = base64.b64decode(parts[1])
    if _Reader(blob).string().decode() != parts[0]:
        raise ValueError("public key type does not match its blob")
    return blob


def key_type(public_key: str) -> str:
    """The algorithm name at the start of an OpenSSH public key line, e.g. ssh-ed25519."""
    return public_key.split()[0]


def normalise(public_key: str) -> str:
    """"type base64", without the comment, which is not part of the key."""
    parts = public_key.split()
    key_blob(public_key)
    return f"{parts[0]} {parts[1]}"


def fingerprint(public_key: str) -> str:
    """The SHA256 fingerprint exactly as `ssh-keygen -l` and GitHub display it."""
    digest = hashlib.sha256(key_blob(public_key)).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


def _signed_data(message: bytes, namespace: str, hash_alg: str) -> bytes:
    digest = hashlib.new(hash_alg, message).digest()
    return _MAGIC + _string(namespace.encode()) + _string(b"") + _string(hash_alg.encode()) + _string(digest)


def _armour(blob: bytes) -> str:
    text = base64.b64encode(blob).decode()
    return "\n".join([_BEGIN, *(text[i : i + 70] for i in range(0, len(text), 70)), _END]) + "\n"


def _unarmour(armoured: str) -> bytes:
    lines = [line.strip() for line in armoured.strip().splitlines()]
    if not lines or lines[0] != _BEGIN or lines[-1] != _END:
        raise ValueError("not an SSH signature")
    return base64.b64decode("".join(lines[1:-1]))


def sign_ed25519(private_key: Ed25519PrivateKey, message: bytes, namespace: str = NAMESPACE) -> str:
    """An SSHSIG signature made directly with an Ed25519 key, byte-compatible with ssh-keygen's."""
    raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pub = _string(b"ssh-ed25519") + _string(raw)
    sig = _string(b"ssh-ed25519") + _string(private_key.sign(_signed_data(message, namespace, "sha512")))
    blob = (
        _MAGIC + struct.pack(">I", _VERSION) + _string(pub) + _string(namespace.encode())
        + _string(b"") + _string(b"sha512") + _string(sig)
    )
    return _armour(blob)


def public_key_line(private_key: Ed25519PrivateKey) -> str:
    """The OpenSSH public key line for an Ed25519 key."""
    return private_key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()


@dataclass(frozen=True)
class _Parsed:
    public_key: bytes
    namespace: str
    hash_alg: str
    signature: bytes


def _parse(armoured: str) -> _Parsed:
    r = _Reader(_unarmour(armoured))
    if r.raw(6) != _MAGIC or r.uint32() != _VERSION:
        raise ValueError("unsupported SSH signature version")
    public_key, namespace = r.string(), r.string().decode()
    r.string()  # reserved
    return _Parsed(public_key, namespace, r.string().decode(), r.string())


def _verify_with_ssh_keygen(armoured: str, message: bytes, namespace: str) -> bool:
    """For key types not handled here: ssh-keygen checks the signature itself."""
    exe = shutil.which("ssh-keygen")
    if exe is None:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        sig = Path(tmp) / "message.sig"
        sig.write_text(armoured, encoding="ascii")
        result = subprocess.run([exe, "-Y", "check-novalidate", "-n", namespace, "-s", str(sig)],
                                input=message, capture_output=True)
        return result.returncode == 0


def verify(public_key: str, armoured: str, message: bytes, namespace: str = NAMESPACE) -> bool:
    """
    True when `armoured` is `public_key`'s signature over `message` in
    `namespace`. The key embedded in the signature must be the expected one:
    a valid signature by some other key is a failure, not a pass.
    """
    try:
        parsed = _parse(armoured)
        if parsed.public_key != key_blob(public_key) or parsed.namespace != namespace:
            return False
        if parsed.hash_alg not in ("sha256", "sha512"):
            return False
        if key_type(public_key) != "ssh-ed25519":
            return _verify_with_ssh_keygen(armoured, message, namespace)
        sig = _Reader(parsed.signature)
        if sig.string() != b"ssh-ed25519":
            return False
        raw_key = _Reader(parsed.public_key)
        raw_key.string()
        Ed25519PublicKey.from_public_bytes(raw_key.string()).verify(
            sig.string(), _signed_data(message, namespace, parsed.hash_alg)
        )
        return True
    except (ValueError, InvalidSignature, struct.error):
        return False
