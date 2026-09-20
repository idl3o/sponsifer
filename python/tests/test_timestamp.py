"""Reading a real RFC 3161 token, offline.

The fixture is a DigiCert token over SHA-256("sponsorable api probe"),
captured once. It lets these tests check parsing and signature verification
without touching the network.

The digest keeps the product's old name on purpose: those are the bytes the
authority actually signed in September 2026, and no rename can change what a
timestamp covers.
"""

import hashlib
from pathlib import Path

from sponsifer.timestamp import Stamp, token_digest, token_time, token_valid

TOKEN = (Path(__file__).parent / "fixtures" / "digicert-probe.tsr").read_bytes()
DIGEST = hashlib.sha256(b"sponsorable api probe").digest()


def test_reads_the_digest_the_token_covers():
    assert token_digest(TOKEN) == DIGEST


def test_reads_an_aware_time():
    assert token_time(TOKEN).tzinfo is not None


def test_verifies_against_the_embedded_certificate():
    assert token_valid(TOKEN, DIGEST)


def test_rejects_a_token_for_a_different_digest():
    assert not token_valid(TOKEN, hashlib.sha256(b"something else").digest())


def test_round_trips_through_json():
    stamp = Stamp("http://tsa.example", TOKEN, token_time(TOKEN))
    assert Stamp.from_json(stamp.to_json()) == stamp
