"""Watermark survival proxy.

Marks a corpus of images with TrustMark, pushes each through the transforms a
sponsor's ad pipeline is likely to apply, and reports how often the serial
comes back bit-exact. It also decodes the unmarked originals, because a mark
that "decodes" from a clean image would be worse than no mark at all.

This is a proxy. The go or no-go test is the real route through each platform,
described in scripts/SURVIVAL.md.

Usage:
    python scripts/survival.py --corpus DIR [--count 24] [--json out.json]
    python scripts/survival.py            # synthetic images, no corpus needed

Deterministic: the corpus sample is an even stride over sorted filenames and
every serial is derived from the image's index, so two runs agree.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageEnhance

Transform = Callable[[Image.Image], Image.Image]

# (model type, BCH schema, label). Schema 0 carries 40 bits, 1 carries 61.
CONFIGS = [("Q", 0, "Q / 40-bit"), ("P", 0, "P / 40-bit"), ("P", 1, "P / 61-bit")]


def jpeg(quality: int) -> Transform:
    """Recompress as JPEG at a given quality."""

    def run(img: Image.Image) -> Image.Image:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=quality)
        return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")

    return run


def webp(quality: int) -> Transform:
    """Recompress as WebP, which is what Meta serves."""

    def run(img: Image.Image) -> Image.Image:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "WEBP", quality=quality)
        return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")

    return run


def width(target: int, then: Transform | None = None) -> Transform:
    """Resize to a target width, keeping aspect, optionally then recompress."""

    def run(img: Image.Image) -> Image.Image:
        h = round(img.height * target / img.width)
        out = img.resize((target, h), Image.LANCZOS)
        return then(out) if then else out

    return run


def crop_aspect(ratio_w: int, ratio_h: int, then: Transform | None = None) -> Transform:
    """Centre-crop to an aspect ratio, as when a landscape asset is reframed."""

    def run(img: Image.Image) -> Image.Image:
        w, h = img.size
        if w / h > ratio_w / ratio_h:
            nw = round(h * ratio_w / ratio_h)
            box = ((w - nw) // 2, 0, (w - nw) // 2 + nw, h)
        else:
            nh = round(w * ratio_h / ratio_w)
            box = (0, (h - nh) // 2, w, (h - nh) // 2 + nh)
        out = img.crop(box)
        return then(out) if then else out

    return run


def crop_centre(keep: float) -> Transform:
    """Keep the central fraction of each dimension."""

    def run(img: Image.Image) -> Image.Image:
        w, h = img.size
        dw, dh = round(w * (1 - keep) / 2), round(h * (1 - keep) / 2)
        return img.crop((dw, dh, w - dw, h - dh))

    return run


def cta_banner(img: Image.Image) -> Image.Image:
    """Overlay a solid call-to-action bar over the bottom 15%, as ad tools do."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    draw.rectangle([0, round(out.height * 0.85), out.width, out.height], fill=(20, 20, 20))
    return jpeg(80)(out)


def grade(img: Image.Image) -> Image.Image:
    """A mild colour grade: brighter, more contrast, slightly desaturated."""
    out = ImageEnhance.Brightness(img).enhance(1.1)
    out = ImageEnhance.Contrast(out).enhance(1.15)
    return jpeg(85)(ImageEnhance.Color(out).enhance(0.9))


def h264(height: int, crf: int) -> Transform:
    """Encode as a one-second H.264 clip and pull a frame back out."""

    def run(img: Image.Image) -> Image.Image:
        with tempfile.TemporaryDirectory() as tmp:
            src, mp4, frame = (Path(tmp) / n for n in ("in.png", "out.mp4", "frame.png"))
            img.convert("RGB").save(src)
            common = ["ffmpeg", "-y", "-loglevel", "error"]
            subprocess.run(
                [*common, "-loop", "1", "-i", str(src), "-t", "1", "-r", "30",
                 "-vf", f"scale=-2:{height}", "-c:v", "libx264", "-crf", str(crf),
                 "-pix_fmt", "yuv420p", str(mp4)],
                check=True,
            )
            subprocess.run([*common, "-ss", "0.5", "-i", str(mp4), "-frames:v", "1", str(frame)], check=True)
            return Image.open(frame).convert("RGB")

    return run


TRANSFORMS: list[tuple[str, Transform]] = [
    ("none", lambda img: img),
    ("JPEG q85", jpeg(85)),
    ("JPEG q70", jpeg(70)),
    ("JPEG q50", jpeg(50)),
    ("WebP q75", webp(75)),
    ("1080w + JPEG q80", width(1080, jpeg(80))),
    ("720w + JPEG q75", width(720, jpeg(75))),
    ("480w + JPEG q75", width(480, jpeg(75))),
    ("crop 90%", crop_centre(0.9)),
    ("crop 80%", crop_centre(0.8)),
    ("reframe 4:5 (feed)", crop_aspect(4, 5, width(1080, jpeg(80)))),
    ("reframe 9:16 (story)", crop_aspect(9, 16, width(1080, jpeg(80)))),
    ("CTA banner", cta_banner),
    ("colour grade", grade),
    ("H.264 1080p crf 23", h264(1080, 23)),
    ("H.264 720p crf 28", h264(720, 28)),
]


def serial_bits(index: int, length: int) -> str:
    """A deterministic serial for image `index`, as a bit string."""
    digest = hashlib.sha256(f"survival-{index}".encode()).digest()
    return "".join(f"{byte:08b}" for byte in digest)[:length]


def synthetic_corpus(count: int) -> list[Image.Image]:
    """Structured, photo-like images for a run without a corpus directory."""
    images = []
    for i in range(count):
        img = Image.new("RGB", (1280, 720))
        draw = ImageDraw.Draw(img)
        for y in range(720):
            draw.line([(0, y), (1280, y)], fill=((40 + y // 4 + i * 9) % 256, 90 + y // 8, 160 - y // 6))
        for k in range(10):
            x, y = (k * 131 + i * 37) % 1100, (k * 71 + i * 53) % 540
            draw.ellipse([x, y, x + 180, y + 180], fill=((k * 40 + i * 13) % 256, 120 + k * 8, 60 + k * 12))
        images.append(img)
    return images


def load_corpus(directory: Path, count: int) -> list[Image.Image]:
    """An even stride across the sorted images in a directory."""
    files = sorted(p for p in directory.rglob("*") if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    if not files:
        sys.exit(f"no images under {directory}")
    stride = max(1, len(files) // count)
    return [Image.open(p).convert("RGB") for p in files[::stride][:count]]


@dataclass
class Tally:
    ok: int = 0
    total: int = 0

    def rate(self) -> str:
        return f"{100 * self.ok / self.total:5.1f}%" if self.total else "  —  "


def run_config(model: str, schema: int, corpus: list[Image.Image]) -> tuple[dict[str, Tally], tuple[int, int]]:
    """
    Mark every image under one configuration and score every transform.

    False positives are counted two ways. TrustMark's decoder auto-detects the
    error-correction schema, and a clean image will sometimes pass as one of the
    weaker schemas. Accepting only the schema that was embedded removes them,
    which is why `sponsifer verify` decodes strictly.
    """
    from trustmark import TrustMark

    tm = TrustMark(verbose=False, model_type=model, encoding_type=schema, loadRemover=False)
    cap = tm.schemaCapacity()
    tallies = {name: Tally() for name, _ in TRANSFORMS}
    loose = strict = 0

    for index, original in enumerate(corpus):
        bits = serial_bits(index, cap)
        marked = tm.encode(original, bits, MODE="binary")
        decoded, present, found = tm.decode(original, MODE="binary")
        loose += int(bool(present))
        strict += int(bool(present) and found == schema and len(decoded) == cap)
        for name, transform in TRANSFORMS:
            decoded, present, _ = tm.decode(transform(marked), MODE="binary")
            tallies[name].total += 1
            tallies[name].ok += int(bool(present) and decoded == bits)
    return tallies, (loose, strict)


def main() -> None:
    """Run every configuration and print one table."""
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--count", type=int, default=24)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    corpus = load_corpus(args.corpus, args.count) if args.corpus else synthetic_corpus(args.count)
    results = {label: run_config(model, schema, corpus) for model, schema, label in CONFIGS}

    print(f"\n{len(corpus)} images, bit-exact serial recovery\n")
    print(f"{'transform':<24}" + "".join(f"{label:>14}" for _, _, label in CONFIGS))
    for name, _ in TRANSFORMS:
        print(f"{name:<24}" + "".join(f"{results[label][0][name].rate():>14}" for _, _, label in CONFIGS))
    print(f"{'false +, any schema':<24}" + "".join(f"{results[label][1][0]:>14}" for _, _, label in CONFIGS))
    print(f"{'false +, strict':<24}" + "".join(f"{results[label][1][1]:>14}" for _, _, label in CONFIGS))

    if args.json:
        payload = {
            label: {"false_positives": {"any_schema": fp[0], "strict": fp[1]}, **{n: t.ok / t.total for n, t in tallies.items()}}
            for label, (tallies, fp) in results.items()
        }
        args.json.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
