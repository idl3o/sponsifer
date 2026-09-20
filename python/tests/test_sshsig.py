"""SSHSIG: our signatures must be OpenSSH's, in both directions."""

import shutil
import subprocess
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from sponsifer import sshsig
from sponsifer.keys import SshKeygenSigner, allowed_signers_line

MESSAGE = b'{"serial":"6715878664","usageRights":"whitelisting-30"}'
ssh_keygen = shutil.which("ssh-keygen")
needs_openssh = pytest.mark.skipif(ssh_keygen is None, reason="ssh-keygen not installed")


@pytest.fixture
def key():
    return Ed25519PrivateKey.from_private_bytes(bytes(range(32)))


def test_round_trip(key):
    pub = sshsig.public_key_line(key)
    assert sshsig.verify(pub, sshsig.sign_ed25519(key, MESSAGE), MESSAGE)


def test_a_changed_message_fails(key):
    pub = sshsig.public_key_line(key)
    assert not sshsig.verify(pub, sshsig.sign_ed25519(key, MESSAGE), MESSAGE + b" ")


def test_another_namespace_fails(key):
    """A signature made for something else cannot be replayed as a receipt signature."""
    pub = sshsig.public_key_line(key)
    assert not sshsig.verify(pub, sshsig.sign_ed25519(key, MESSAGE, namespace="file"), MESSAGE)


def test_a_valid_signature_by_another_key_fails(key):
    other = Ed25519PrivateKey.from_private_bytes(bytes(range(1, 33)))
    assert not sshsig.verify(sshsig.public_key_line(key), sshsig.sign_ed25519(other, MESSAGE), MESSAGE)


def test_garbage_fails_rather_than_raising(key):
    assert not sshsig.verify(sshsig.public_key_line(key), "not a signature", MESSAGE)


def test_fingerprint_matches_the_openssh_format(key):
    assert sshsig.fingerprint(sshsig.public_key_line(key)).startswith("SHA256:")
    assert "=" not in sshsig.fingerprint(sshsig.public_key_line(key))


def _ssh_key(tmp_path: Path) -> Path:
    path = tmp_path / "id_ed25519"
    subprocess.run([ssh_keygen, "-q", "-t", "ed25519", "-N", "", "-C", "test", "-f", str(path)], check=True)
    return path


@needs_openssh
def test_openssh_verifies_what_we_sign(tmp_path, key):
    pub = sshsig.public_key_line(key)
    (tmp_path / "msg").write_bytes(MESSAGE)
    (tmp_path / "msg.sig").write_text(sshsig.sign_ed25519(key, MESSAGE), encoding="ascii")
    (tmp_path / "allowed_signers").write_text(allowed_signers_line("ada-trelawny", pub) + "\n", encoding="ascii")
    result = subprocess.run(
        [ssh_keygen, "-Y", "verify", "-f", str(tmp_path / "allowed_signers"), "-I", "ada-trelawny",
         "-n", sshsig.NAMESPACE, "-s", str(tmp_path / "msg.sig")],
        input=MESSAGE, capture_output=True,
    )
    assert result.returncode == 0, result.stderr.decode()


@needs_openssh
def test_we_verify_what_openssh_signs(tmp_path):
    signer = SshKeygenSigner(_ssh_key(tmp_path))
    armoured = signer.sign(MESSAGE)
    assert sshsig.verify(signer.public_key, armoured, MESSAGE)
    assert not sshsig.verify(signer.public_key, armoured, MESSAGE + b"x")
