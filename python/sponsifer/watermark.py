"""The invisible watermark, and a perceptual hash for when it does not survive.

TrustMark, model Q, BCH_SUPER schema: 40 bits with the strongest error
correction. `scripts/survival.py` chose it: it recovered every serial through
recompression, downscaling, cropping, grading and H.264, and failed only when
a landscape asset was reframed to a portrait aspect. So seal each aspect ratio
you deliver.

Decoding is strict. TrustMark detects the schema from the payload, and a clean
image will sometimes pass as a weaker schema. Accepting only BCH_SUPER at
exactly 40 bits took false positives from 8 in 400 to none in 400.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import imagehash
from PIL import Image

from .receipt import SERIAL_BITS

MODEL = "Q"
SCHEMA = 0  # TrustMark Encoding.BCH_SUPER


class Watermarker(Protocol):
    """Embeds and extracts a serial. Tests use a fake; `seal` uses TrustMark."""

    def embed(self, image: Image.Image, bits: str) -> Image.Image: ...

    def extract(self, image: Image.Image) -> str | None: ...


@lru_cache(maxsize=1)
def _trustmark():
    # Imported lazily: loading torch takes seconds, and `serve` never needs it.
    from trustmark import TrustMark

    return TrustMark(verbose=False, model_type=MODEL, encoding_type=SCHEMA, loadRemover=False)


@dataclass(frozen=True)
class TrustMarkWatermarker:
    """The production watermarker."""

    def embed(self, image: Image.Image, bits: str) -> Image.Image:
        if len(bits) != SERIAL_BITS:
            raise ValueError(f"serial must be {SERIAL_BITS} bits")
        return _trustmark().encode(image.convert("RGB"), bits, MODE="binary")

    def extract(self, image: Image.Image) -> str | None:
        bits, present, schema = _trustmark().decode(image.convert("RGB"), MODE="binary")
        if not present or schema != SCHEMA or len(bits) != SERIAL_BITS:
            return None
        return bits


def prefetch() -> None:
    """Download TrustMark's model weights now rather than mid-seal."""
    _trustmark()


def perceptual_hash(image: Image.Image) -> str:
    """A 64-bit pHash, hex. Survives re-encoding; not evidence on its own."""
    return str(imagehash.phash(image.convert("RGB")))


def hash_distance(a: str, b: str) -> int:
    """Hamming distance between two pHashes."""
    return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)


#: At or below this distance two images are probably the same picture.
RESEMBLANCE = 10
