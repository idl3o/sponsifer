"""A C2PA manifest carrying the licence, for pipelines that keep it.

Most platforms strip C2PA on upload, which is why the watermark exists. Where
a manifest survives, it states the terms and says the file was watermarked,
signed by the creator's local chain. Validators report that chain as
untrusted, and that is accurate.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

#: How the asset was made, as IPTC digital source types. The creator must say;
#: the tool cannot know, and a default would be a claim nobody made.
SOURCE_TYPES = {
    "capture": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    "creation": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation",
    "ai": "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    "ai-composite": "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
}


def licence_manifest(terms: dict[str, Any], *, title: str, source: str, version: str) -> dict[str, Any]:
    """The manifest JSON: who made it, how, that it is watermarked, and the licence."""
    return {
        "claim_generator_info": [{"name": "sponsifer", "version": version}],
        "title": title,
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {"action": "c2pa.created", "digitalSourceType": SOURCE_TYPES[source]},
                        {"action": "c2pa.watermarked"},
                    ]
                },
            },
            {"label": "org.sponsifer.licence", "data": terms},
        ],
    }


def embed(src: Path, dst: Path, manifest: dict[str, Any], chain: bytes, key: bytes) -> None:
    """Sign `manifest` into a copy of `src` at `dst`."""
    import c2pa

    info = c2pa.C2paSignerInfo(c2pa.C2paSigningAlg.ES256, chain, key, None)
    signer = c2pa.Signer.from_info(info)
    c2pa.Builder(manifest).sign_file(str(src), str(dst), signer)


def read_licence(path: Path) -> dict[str, Any] | None:
    """The licence assertion from a file's active manifest, if it still has one."""
    import json

    import c2pa

    try:
        data = json.loads(c2pa.Reader(str(path)).json())
    except Exception:  # noqa: BLE001 - no manifest, or an unreadable one
        return None
    active = data.get("manifests", {}).get(data.get("active_manifest", ""), {})
    return next((a["data"] for a in active.get("assertions", []) if a.get("label") == "org.sponsifer.licence"), None)
