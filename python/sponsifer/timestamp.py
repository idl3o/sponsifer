"""RFC 3161 timestamping: the one network call in Sponsifer.

A salted commitment's SHA-256 digest goes to a timestamp authority, which
returns a signed token saying it saw that digest at a given time. The digest
reveals nothing about the deal. The call happens only inside `seal`, after
the creator has confirmed.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import rfc3161ng
from pyasn1.codec.der import decoder, encoder

#: DigiCert's public timestamp authority: free, no account, widely trusted.
DEFAULT_TSA = "http://timestamp.digicert.com"


@dataclass(frozen=True)
class Stamp:
    """A timestamp token and what it says."""

    tsa: str
    token: bytes
    time: datetime

    def to_json(self) -> dict[str, str]:
        return {"tsa": self.tsa, "token": base64.b64encode(self.token).decode(), "time": self.time.isoformat()}

    @staticmethod
    def from_json(data: dict[str, str]) -> "Stamp":
        return Stamp(data["tsa"], base64.b64decode(data["token"]), datetime.fromisoformat(data["time"]))


#: Anything that turns a digest into a Stamp. Tests pass a fake; `seal` passes `remote`.
Timestamper = Callable[[bytes], Stamp]


def remote(url: str = DEFAULT_TSA) -> Timestamper:
    """A timestamper that asks a real RFC 3161 authority."""

    def stamp(digest: bytes) -> Stamp:
        client = rfc3161ng.RemoteTimestamper(url, hashname="sha256", include_tsa_certificate=True, timeout=20)
        token = client.timestamp(digest=digest)
        return Stamp(url, token, token_time(token))

    return stamp


def token_time(token: bytes) -> datetime:
    """The time the authority asserts, timezone-aware."""
    return rfc3161ng.get_timestamp(token, naive=False)


def token_digest(token: bytes) -> bytes:
    """The digest the token covers, read from its message imprint."""
    parsed = decoder.decode(token, asn1Spec=rfc3161ng.TimeStampToken())[0]
    return bytes(parsed.tst_info["messageImprint"]["hashedMessage"])


def token_valid(token: bytes, digest: bytes) -> bool:
    """
    True when the token covers `digest` and is signed by a certificate it
    carries. This proves the token is intact and was issued by the holder of
    that certificate; it does not walk the chain to a trusted root, and the
    output of `verify` says so.
    """
    if token_digest(token) != digest:
        return False
    parsed = decoder.decode(token, asn1Spec=rfc3161ng.TimeStampToken())[0]
    for entry in parsed.content["certificates"]:
        certificate = encoder.encode(entry["certificate"])
        try:
            if rfc3161ng.check_timestamp(token, certificate=certificate, digest=digest, hashname="sha256"):
                return True
        except Exception:  # noqa: BLE001 - a non-signing certificate raises; try the next
            continue
    return False
