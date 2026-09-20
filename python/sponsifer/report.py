"""The delivery report: what was on air, signed so the sponsor can check it.

A sponsor who paid for a placement asks one question afterwards: was it up,
and when? The on-air log answers it, but the log is the creator's own file on
the creator's own machine. The report is the log's summary, signed with the
creator's SSH key, so the sponsor holds a document the creator cannot later
change, and can verify with nothing but OpenSSH.

What the report is and is not:

- It is an **index into the recording**. Each interval is a UTC time and,
  where the logger saw the stream start, an offset into the stream, so the
  sponsor can open the VOD at that minute and see the placement. The VOD is
  the evidence; the report says where to look.
- It is **not proof on its own**, and the notice says so. It also says that
  the platform deletes the recording after a while, so the sponsor checks
  while checking is still possible.
- It **hides nothing**. The polls that contradicted OBS's events, and any
  interval the logger stopped inside, are in the report with a count and a
  time. A report that smoothed those away would be worth less.
- It **carries no price**. The CLI does not price, and a delivery record is
  not an invoice.

It is signed under its own SSHSIG namespace, `sponsifer-delivery`, distinct
from the receipts', so a signature over a report can never be presented as a
signature over a licence, or the reverse.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from . import onair, receipt
from .brand import PRODUCT

#: 2: one report covers every placement, each with its own total.
REPORT_VERSION = 2
#: The SSHSIG namespace for delivery reports. Receipts have their own.
NAMESPACE = "sponsifer-delivery"
#: Reports live beside the ledger and the on-air logs.
REPORTS_DIR = "reports"

#: How long each platform keeps a live recording, from the research note.
VOD_RETENTION = {
    "twitch": "Twitch keeps a past broadcast for 7 days, 14 for Affiliates and 60 for Partners, "
              "and highlights do not expire",
    "youtube": "YouTube keeps a live archive until the creator removes it",
}


def build_report(
    deal: dict[str, Any],
    delivery: onair.Delivery,
    *,
    creator: str,
    public_key: str,
    reported_at: str,
    log_sha256: str,
    vod_url: str = "",
) -> dict[str, Any]:
    """
    The document that is signed. Pure: the caller supplies the time and the
    log's hash, so the same inputs always give the same bytes.
    """
    summary = delivery.to_json()
    return {
        "version": REPORT_VERSION,
        "kind": "delivery-report",
        "dealId": deal["id"],
        "creator": creator,
        "sponsor": deal.get("brand", ""),
        "platform": deal.get("platform", ""),
        "format": deal.get("format", ""),
        "sources": summary["sources"],
        "streamStartedAt": summary["streamStartedAt"],
        "startObserved": summary["startObserved"],
        "intervals": summary["intervals"],
        "placements": summary["placements"],
        "totalSeconds": summary["totalSeconds"],
        "disagreements": summary["disagreements"],
        "openSince": summary["openSince"],
        "vodUrl": vod_url,
        "logSha256": log_sha256,
        "publicKey": public_key,
        "reportedAt": reported_at,
        "software": PRODUCT,
    }


def commitment(report: dict[str, Any]) -> str:
    """SHA-256 of the canonical report, hex: the same construction as a receipt's."""
    return receipt.commitment(report)


def _span(seconds: float) -> str:
    whole = int(round(seconds))
    minutes, secs = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m {secs:02d}s"
    return f"{minutes}m {secs:02d}s" if minutes else f"{secs}s"


def _clock(seconds: float | None) -> str:
    if seconds is None:
        return "offset unknown, the logger joined after the stream began"
    whole = int(round(seconds))
    minutes, secs = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:d}:{minutes:02d}:{secs:02d} into the stream"


def _interval_lines(report: dict[str, Any]) -> list[str]:
    lines = []
    for i, interval in enumerate(report["intervals"], start=1):
        lines.append(f"  {i}. \"{interval['source']}\": {interval['start']} to {interval['end']}  "
                     f"({_span(interval['seconds'])}), {_clock(interval['streamOffsetSeconds'])}")
    if not lines:
        lines.append("  none completed")
    return lines


def _placement_lines(report: dict[str, Any]) -> list[str]:
    """Each placement's own total, when the deal had more than one."""
    if len(report["placements"]) < 2:
        return []
    lines = ["By placement:"]
    for p in report["placements"]:
        count = p["intervals"]
        lines.append(f"  \"{p['source']}\": {_span(p['totalSeconds'])} across {count} interval{'s' if count != 1 else ''}")
    lines.append("The total above counts a moment once, however many placements were up in it.")
    return lines


def _integrity_lines(report: dict[str, Any]) -> list[str]:
    lines = []
    n = report["disagreements"]
    if n:
        lines.append(f"{n} time{'s' if n != 1 else ''} the logger's direct check of OBS contradicted the event OBS had sent; "
                     "each is in the log, and the direct check is what counts.")
    else:
        lines.append("The logger's direct checks of OBS never contradicted its events.")
    if report["openSince"]:
        lines.append(f"The logger stopped while the placement was still on air, at {report['openSince']}. "
                     "That time is not counted above.")
    if not report["startObserved"] and report["intervals"]:
        lines.append("The logger joined after the stream began, so offsets into the recording are not given; "
                     "use the UTC times against the recording's start.")
    return lines


def sponsor_notice(report: dict[str, Any], *, fingerprint: str, allowed_signers: str, identity: str) -> str:
    """
    The plain-text report the sponsor receives.

    It says where to look in the recording, what the log could and could not
    see, and how to check the signature with OpenSSH alone.
    """
    name = report_name(report)
    retention = VOD_RETENTION.get(report["platform"], "the platform keeps a recording for a limited time")
    where = f"The recording is at {report['vodUrl']}." if report["vodUrl"] else "Ask for the recording's address if you do not have it."
    return "\n".join(
        [
            f"Delivery report: {report['creator']} to {report['sponsor']}",
            "",
            f"Placements watched: {', '.join(report['sources'])}. A {report['format']} on {report['platform']}, deal {report['dealId']}.",
            f"On air for {_span(report['totalSeconds'])} in total, across {len(report['intervals'])} interval"
            f"{'s' if len(report['intervals']) != 1 else ''}:",
            *_interval_lines(report),
            *_placement_lines(report),
            "",
            "On air means the stream was live and the named source was in the broadcast feed, as reported by",
            "OBS Studio and checked directly against it every few seconds. Times are UTC wall clock.",
            *_integrity_lines(report),
            "",
            "This report is an index into the recording, not proof on its own. Open the recording at the",
            f"offsets above and the placement is there to see. {where}",
            f"Please check soon: {retention}.",
            "",
            f"The signed report is {name}.report.json, with its signature in {name}.report.json.sig.",
            f"Its SHA-256 is {commitment(report)}.",
            f"It is signed with the SSH key {fingerprint}, the fingerprint in our agreement.",
            "",
            "To check the signature with nothing but OpenSSH, save this line as allowed_signers:",
            f"  {allowed_signers}",
            "and run:",
            f"  ssh-keygen -Y verify -f allowed_signers -I {identity} -n {NAMESPACE} \\",
            f"    -s {name}.report.json.sig < {name}.report.json",
            "",
            "Please keep these files with the contract.",
        ]
    )


def report_name(report: dict[str, Any]) -> str:
    """A filename stem: the deal and the moment the report was made, e.g. dl-104-20260918T163000Z."""
    stamp = re.sub(r"[^0-9TZ]", "", report["reportedAt"].replace("+00:00", "Z"))
    return f"{report['dealId']}-{stamp}"


def reports_dir(home: Path) -> Path:
    """Where reports are written."""
    return home / REPORTS_DIR


def write(home: Path, report: dict[str, Any], signature: str, notice: str, signed_bytes: bytes) -> list[Path]:
    """Write the sponsor's three files. Refuses to overwrite: a report, once made, stands."""
    folder = reports_dir(home)
    folder.mkdir(parents=True, exist_ok=True)
    name = report_name(report)
    paths = [folder / f"{name}.txt", folder / f"{name}.report.json", folder / f"{name}.report.json.sig"]
    for path in paths:
        if path.exists():
            raise FileExistsError(f"{path.name} already exists")
    paths[0].write_text(notice, encoding="utf-8")
    paths[1].write_bytes(signed_bytes)
    paths[2].write_text(signature, encoding="ascii")
    # A record for the creator, beside the sponsor's files, holding everything at once.
    (folder / f"{name}.json").write_text(
        json.dumps({"report": report, "commitment": commitment(report), "signature": signature, "signatureFormat": "sshsig"},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return paths
