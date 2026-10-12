import hashlib
import importlib.util
import json
import random
import tempfile
import unittest
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location("import_photo", Path(__file__).resolve().parents[1] / "travel/scripts/import_photo.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PhotoImportTest(unittest.TestCase):
    def test_original_is_preserved_and_derivatives_are_oriented_without_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.jpg"
            exif = Image.Exif()
            exif[274] = 6
            exif[315] = "private source metadata"
            Image.new("RGB", (1600, 800), "#bb9966").save(source, exif=exif)
            record = module.import_photo(source, place="Louvre", lat=48.8606, lon=2.3376, root=root, photo_id="louvre")
            self.assertEqual((record["width"], record["height"]), (800, 1600))
            self.assertEqual((root / record["original"]["src"]).read_bytes(), source.read_bytes())
            self.assertEqual(record["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
            for name, variant in record["variants"].items():
                with Image.open(root / variant["src"]) as result:
                    self.assertEqual(result.format, "WEBP")
                    self.assertEqual(result.height, 2 * result.width)
                    self.assertLessEqual(max(result.size), module.VARIANTS[name][0])
                    self.assertFalse(result.getexif())
            self.assertNotIn("date", record)

    def test_reimport_updates_the_tag_without_duplicate_photos_or_upscaling(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.png"
            Image.new("RGB", (100, 50), "green").save(source)
            first = module.import_photo(source, place="Louvre", lat=48.8606, lon=2.3376, root=root)
            second = module.import_photo(source, place="Louvre", lat=48.8606, lon=2.3376, caption="Pyramid", root=root)
            manifest = json.loads((root / "data/photos.json").read_text())
            self.assertEqual(len(manifest["photos"]), 1)
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(first["variants"], second["variants"])
            self.assertTrue(all(v["width"] == 100 for v in second["variants"].values()))
            self.assertEqual(manifest["photos"][0]["caption"], "Pyramid")

    def test_invalid_coordinates_do_not_create_assets_or_a_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for lat, lon in [(91, 2), (48, 181), (float("nan"), 2)]:
                with self.assertRaises(ValueError):
                    module.import_photo(root / "missing.jpg", place="Louvre", lat=lat, lon=lon, root=root)
            self.assertFalse((root / "photos").exists())
            self.assertFalse((root / "data/photos.json").exists())

    def test_full_size_jpeg_keeps_compressed_pixels_when_smaller_than_webp(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "grain.jpg"
            exif = Image.Exif()
            exif[315] = "source metadata"
            image = Image.frombytes("RGB", (300, 200), random.Random(7).randbytes(300 * 200 * 3))
            image.save(source, quality=85, exif=exif)
            record = module.import_photo(source, place="Louvre", lat=48.8606, lon=2.3358, root=root)
            variant = record["variants"]["large"]
            with Image.open(source) as original, Image.open(root / variant["src"]) as derivative:
                self.assertEqual(derivative.format, "JPEG")
                self.assertEqual(derivative.tobytes(), original.tobytes())
                self.assertFalse(derivative.getexif())
            self.assertLess(variant["bytes"], source.stat().st_size)


if __name__ == "__main__":
    unittest.main()
