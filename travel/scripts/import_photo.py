#!/usr/bin/env python3
"""Add a geotagged photo and immutable, responsive image derivatives to the atlas."""
import argparse
import hashlib
import io
import json
import math
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = {"thumbnail": (128, 86), "small": (640, 90), "medium": (1280, 93), "large": (2400, 94)}
PIPELINE_VERSION = "2"


def jpeg_without_metadata(content):
    """Remove JPEG metadata segments while preserving compressed image data exactly."""
    if not content.startswith(b"\xff\xd8"):
        raise ValueError("Invalid JPEG header")
    output, offset = bytearray(content[:2]), 2
    while offset < len(content):
        start = offset
        if content[offset] != 0xFF:
            raise ValueError("Invalid JPEG marker")
        while offset < len(content) and content[offset] == 0xFF:
            offset += 1
        if offset >= len(content):
            break
        marker = content[offset]
        offset += 1
        if marker == 0xDA:  # Keep scan headers, compressed pixels, and all subsequent scans.
            output.extend(content[start:])
            return bytes(output)
        if offset + 2 > len(content):
            break
        length = int.from_bytes(content[offset:offset + 2], "big")
        if length < 2 or offset + length > len(content):
            break
        end = offset + length
        # APP0/JFIF and APP14/Adobe affect interpretation; other APP segments and
        # comments carry metadata. This fast path never processes an ICC image.
        if not (0xE1 <= marker <= 0xEF and marker != 0xEE) and marker != 0xFE:
            output.extend(content[start:end])
        offset = end
    raise ValueError("JPEG has no valid image scan")


def atomic_bytes(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def import_photo(source, *, place, lat, lon, photo_id=None, country=None, caption="", date=None, root=ROOT):
    source, root = Path(source), Path(root)
    if not place.strip():
        raise ValueError("A place name is required")
    if not all(math.isfinite(n) for n in (lat, lon)) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError("Latitude/longitude must be finite and within geographic bounds")
    if date:
        datetime.strptime(date, "%Y-%m-%d")
    original = source.read_bytes()
    if source.suffix.lower() in {".heic", ".heif"}:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    digest = hashlib.sha256(original).hexdigest()
    photo_id = photo_id or (re.sub(r"[^a-z0-9]+", "-", place.lower()).strip("-") or "photo") + "-" + digest[:8]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", photo_id):
        raise ValueError("Photo ID must use lowercase letters, digits and hyphens (max 100 characters)")
    manifest_path = root / "data/photos.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"photos": []}
    with Image.open(io.BytesIO(original)) as raw:
        extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "HEIF": ".heic"}.get(raw.format)
        if not extension or getattr(raw, "n_frames", 1) != 1:
            raise ValueError("Use a single JPEG, PNG, WebP or HEIC image")
        # Apply EXIF rotation before resizing.
        image = ImageOps.exif_transpose(raw)
        profile = image.info.get("icc_profile")
        passthrough = None
        if raw.format == "JPEG" and raw.mode == "RGB" and raw.getexif().get(274, 1) == 1 and not profile:
            passthrough = jpeg_without_metadata(original)
        if profile:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode="RGB")
        else:
            image = image.convert("RGB")
        width, height = image.size
        fingerprint = hashlib.sha256((digest + PIPELINE_VERSION + repr(VARIANTS)).encode()).hexdigest()[:16]
        directory = root / "photos" / photo_id
        variants = {}
        for name, (edge, quality) in VARIANTS.items():
            resized = image.copy()
            resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            resized.save(output, "WEBP", quality=quality, method=6)
            content, suffix = output.getvalue(), ".webp"
            if passthrough and resized.size == image.size and len(passthrough) < len(content):
                content, suffix = passthrough, ".jpg"
            path = directory / f"{fingerprint}-{name}{suffix}"
            atomic_bytes(path, content)
            variants[name] = {"src": path.relative_to(root).as_posix(), "width": resized.width, "height": resized.height, "bytes": path.stat().st_size}
    record = {"id": photo_id, "place": place.strip(), "coords": [lat, lon], "caption": caption.strip(), "width": width, "height": height,
              "sha256": digest, "variants": variants}
    if country:
        record["country"] = str(country)
    if date:
        record["date"] = date
    manifest["photos"] = [photo for photo in manifest.get("photos", []) if photo["id"] != photo_id] + [record]
    atomic_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode())
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--place", required=True)
    parser.add_argument("--lat", required=True, type=float)
    parser.add_argument("--lon", required=True, type=float)
    parser.add_argument("--id", dest="photo_id")
    parser.add_argument("--country")
    parser.add_argument("--caption", default="")
    parser.add_argument("--date", help="Optional confirmed date, YYYY-MM-DD")
    args = parser.parse_args()
    try:
        photo = import_photo(**vars(args))
    except (ValueError, OSError, ImageCms.PyCMSError) as error:
        parser.exit(1, f"Photo import failed: {error}\n")
    sizes = ", ".join(f"{name}: {value['bytes'] / 1024:.0f} KB" for name, value in photo["variants"].items())
    print(f"Imported {photo['place']} ({photo['width']} × {photo['height']}); {sizes}.")


if __name__ == "__main__":
    main()
