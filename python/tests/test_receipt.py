"""The rules that make a seal evidence, tested directly."""

from datetime import date

import pytest

from sponsifer import receipt

DEAL = {
    "id": "dl-104",
    "outcome": "won",
    "brand": "Hetzner",
    "platform": "youtube",
    "format": "integration",
    "terms": {"usageRights": "whitelisting-30", "exclusivityDays": 30},
    "paidUsageDays": 30,
    "closedOn": "2026-09-10",
    "deliveredOn": "",
    "seal": None,
}


def build(**overrides):
    fields = dict(
        creator="Ada Trelawny",
        serial="0a1b2c3d4e",
        salt=bytes(16),
        master_sha256="m" * 64,
        sealed_sha256="s" * 64,
        perceptual_hash="f" * 16,
        public_key="ab" * 32,
        sealed_on="2026-09-10",
    )
    fields.update(overrides)
    return receipt.build_receipt(DEAL, **fields)


def test_canonical_form_ignores_key_order():
    assert receipt.canonical({"b": 1, "a": 2}) == receipt.canonical({"a": 2, "b": 1})


def test_commitment_binds_every_term():
    base = receipt.commitment(build())
    assert receipt.commitment(build(sealed_sha256="t" * 64)) != base
    assert receipt.commitment({**build(), "paidUsageDays": 90}) != base


def test_serials_round_trip_and_refuse_degenerate_patterns():
    bits = receipt.serial_from(b"salt", "m" * 64, "dl-104")
    assert receipt.serial_usable(bits)
    assert receipt.hex_to_bits(receipt.bits_to_hex(bits)) == bits
    assert not receipt.serial_usable("0" * receipt.SERIAL_BITS)
    assert not receipt.serial_usable("1" * receipt.SERIAL_BITS)
    assert not receipt.serial_usable("01" * 10)


@pytest.mark.parametrize(
    ("deal", "in_ledger", "fragment"),
    [
        (None, False, "no deal"),
        ({**DEAL, "outcome": "lost"}, False, "won"),
        ({**DEAL, "deliveredOn": "2026-09-12"}, False, "before delivery"),
        ({**DEAL, "seal": {"serial": "x"}}, False, "already sealed"),
        (DEAL, True, "already sealed"),
    ],
)
def test_seal_refusals(deal, in_ledger, fragment):
    assert fragment in (receipt.seal_refusal(deal, in_ledger) or "")


def test_a_won_undelivered_deal_can_be_sealed():
    assert receipt.seal_refusal(DEAL, False) is None


def claim(**overrides):
    fields = dict(
        commitment_ok=True,
        signature_ok=True,
        timestamp_ok=True,
        timestamped_on=date(2026, 9, 10),
        started_on=date(2026, 10, 1),
        seen_on=date(2026, 12, 15),
    )
    fields.update(overrides)
    return receipt.assess_claim(build(), **fields)


def test_a_claim_holds_when_sealed_before_the_ad_ran():
    result = claim()
    assert result.holds
    assert (result.days_run, result.permitted, result.overrun_days) == (75, 30, 45)


def test_a_seal_made_after_the_ad_started_proves_nothing_about_it():
    """Non-retroactivity: a backdated ledger entry gets today's timestamp and fails here."""
    result = claim(timestamped_on=date(2026, 10, 2))
    assert not result.holds
    assert "says nothing about this ad" in result.checks[-1][2]


def test_a_seal_on_the_start_day_is_not_before_it():
    assert not claim(timestamped_on=date(2026, 10, 1)).holds


@pytest.mark.parametrize("broken", ["commitment_ok", "signature_ok", "timestamp_ok"])
def test_every_check_is_necessary(broken):
    assert not claim(**{broken: False}).holds


def test_unlimited_usage_never_overruns():
    body = {**build(), "paidUsageDays": None}
    result = receipt.assess_claim(
        body, commitment_ok=True, signature_ok=True, timestamp_ok=True,
        timestamped_on=date(2026, 9, 1), started_on=date(2026, 10, 1), seen_on=date(2029, 1, 1),
    )
    assert result.overrun_days == 0


def notice():
    return receipt.sponsor_notice(
        build(),
        fingerprint="SHA256:abc",
        allowed_signers='ada-trelawny namespaces="sponsifer-receipt" ssh-ed25519 AAAA',
        identity="ada-trelawny",
        timestamped_at="2026-09-10T12:00:00+00:00",
    )


def test_the_sponsor_is_told_the_file_is_marked():
    text = notice()
    assert "invisible watermark" in text
    assert "0a1b2c3d4e" in text
    assert "30 days of paid usage" in text


def test_the_sponsor_is_told_how_to_verify_without_this_software():
    text = notice()
    assert "ssh-keygen -Y verify -f allowed_signers -I ada-trelawny -n sponsifer-receipt" in text
    assert "SHA256:abc" in text
