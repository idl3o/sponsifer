"""The creator's signing key, and a local certificate chain for C2PA.

Receipts are signed with the creator's own SSH key through `ssh-keygen -Y
sign`. Sponsifer never reads the private key: passphrases, ssh-agent and
hardware keys (`ed25519-sk`) are OpenSSH's business, which is where a key
belongs. The public key is what goes into the receipt, its SHA256
fingerprint goes into the contract, and a technical creator has usually
published it already, at github.com/<user>.keys.

C2PA needs an X.509 chain, which an SSH key cannot provide, so a separate
P-256 key signs manifests under a local root. It carries no identity: a
validator shows it as untrusted, which is accurate, and the receipt signature
is what a claim rests on. It is created on first use and can be regenerated.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from . import sshsig
from .brand import PRODUCT

_PKCS8 = (serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


class NoKey(Exception):
    """No usable SSH key is configured, with instructions for making one."""


class Signer(Protocol):
    """
    Signs receipts and delivery reports. Production uses ssh-keygen; tests use
    an in-memory key. Each kind of document has its own SSHSIG namespace, so a
    signature over one can never be passed off as a signature over the other.
    """

    @property
    def public_key(self) -> str: ...

    def sign(self, message: bytes, namespace: str = sshsig.NAMESPACE) -> str: ...


def _public_key_for(key: Path) -> str:
    pub = key if key.suffix == ".pub" else key.with_name(key.name + ".pub")
    if not pub.exists():
        raise NoKey(f"no public key at {pub}")
    return sshsig.normalise(pub.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class SshKeygenSigner:
    """Signs with `ssh-keygen -Y sign`, which prompts for a passphrase or uses the agent itself."""

    key: Path
    public_key: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "public_key", _public_key_for(self.key))

    def sign(self, message: bytes, namespace: str = sshsig.NAMESPACE) -> str:
        exe = shutil.which("ssh-keygen")
        if exe is None:
            raise NoKey("ssh-keygen is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "document.json"
            target.write_bytes(message)
            # stdin and the console are left alone so OpenSSH can ask for a passphrase.
            result = subprocess.run([exe, "-Y", "sign", "-q", "-f", str(self.key), "-n", namespace, str(target)])
            signature = target.with_name("document.json.sig")
            if result.returncode != 0 or not signature.exists():
                raise NoKey("ssh-keygen did not sign the document")
            return signature.read_text(encoding="ascii")


@dataclass(frozen=True)
class Ed25519Signer:
    """Signs in memory. For tests, and for nothing that holds a real identity."""

    private_key: Ed25519PrivateKey

    @property
    def public_key(self) -> str:
        return sshsig.public_key_line(self.private_key)

    def sign(self, message: bytes, namespace: str = sshsig.NAMESPACE) -> str:
        return sshsig.sign_ed25519(self.private_key, message, namespace)


def _config_path(home: Path) -> Path:
    return home / "config.json"


def configured_key(home: Path) -> Path | None:
    """The key set with `sponsifer key --ssh`, else ~/.ssh/id_ed25519 if it exists."""
    config = _config_path(home)
    if config.exists():
        path = json.loads(config.read_text(encoding="utf-8")).get("sshKey")
        if path:
            return Path(path)
    default = Path.home() / ".ssh" / "id_ed25519"
    return default if default.with_name("id_ed25519.pub").exists() else None


def set_key(home: Path, key: Path) -> str:
    """Remember which SSH key signs receipts. Returns its public key line."""
    public = _public_key_for(key)
    home.mkdir(parents=True, exist_ok=True)
    _config_path(home).write_text(json.dumps({"sshKey": str(key.resolve())}, indent=2), encoding="utf-8")
    return public


def signer_for(home: Path) -> SshKeygenSigner:
    """The production signer, or instructions when there is no key to sign with."""
    key = configured_key(home)
    if key is None:
        raise NoKey(
            "no SSH key to sign receipts with. Make one with `ssh-keygen -t ed25519` "
            "(or `-t ed25519-sk` for a hardware key), then run `sponsifer key --ssh ~/.ssh/id_ed25519`"
        )
    return SshKeygenSigner(key)


def principal(name: str) -> str:
    """A signer identity for allowed_signers: lowercase, no spaces."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "creator"


def allowed_signers_line(identity: str, public_key: str, namespace: str = sshsig.NAMESPACE) -> str:
    """The line a sponsor saves as allowed_signers to check a document with ssh-keygen."""
    return f'{identity} namespaces="{namespace}" {sshsig.normalise(public_key)}'


def _name(common: str) -> x509.Name:
    return x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, common), x509.NameAttribute(NameOID.ORGANIZATION_NAME, PRODUCT)]
    )


def _cert(
    subject: x509.Name,
    issuer: x509.Name,
    public: ec.EllipticCurvePublicKey,
    signer: ec.EllipticCurvePrivateKey,
    *,
    ca: bool,
    now: dt.datetime,
) -> x509.Certificate:
    """One certificate meeting the C2PA profile: key identifiers, usage, and EKU on the leaf."""
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(public)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(public), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(signer.public_key()), critical=False)
    )
    if ca:
        builder = builder.add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
    else:
        builder = builder.add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
        builder = builder.add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
    return builder.sign(signer, hashes.SHA256())


def c2pa_credentials(home: Path, creator: str) -> tuple[bytes, bytes]:
    """
    A certificate chain and private key for C2PA signing, created once.

    C2PA refuses a bare self-signed certificate, so a local root signs the
    leaf. The root exists only to satisfy the format, and its name says so.
    @returns (chain PEM, leaf private key PEM).
    """
    chain_path, key_path = home / "c2pa-chain.pem", home / "c2pa-key.pem"
    if chain_path.exists() and key_path.exists():
        return chain_path.read_bytes(), key_path.read_bytes()
    home.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    root_key, leaf_key = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    root_name = _name(f"{PRODUCT} local root (not a trusted CA)")
    root = _cert(root_name, root_name, root_key.public_key(), root_key, ca=True, now=now)
    leaf = _cert(_name(creator or f"{PRODUCT} creator"), root_name, leaf_key.public_key(), root_key, ca=False, now=now)
    chain = leaf.public_bytes(serialization.Encoding.PEM) + root.public_bytes(serialization.Encoding.PEM)
    chain_path.write_bytes(chain)
    key_path.write_bytes(leaf_key.private_bytes(*_PKCS8))
    return chain, key_path.read_bytes()
