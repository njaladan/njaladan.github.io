"""Browser checks using temporary photo data; no sample visits are published."""
import functools
import importlib.util
import shutil
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_photo", REPO / "travel/scripts/import_photo.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipUnless(sync_playwright and shutil.which("chromium"), "Requires Playwright and Chromium")
class TravelPhotosTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.assets = Path(cls.temporary.name)
        source = cls.assets / "fixture.jpg"
        Image.new("RGB", (1600, 1000), "#837e68").save(source)
        cls.photos = [importer.import_photo(source, place=f"Fixture {index}", lat=48.8606 + dy, lon=2.3358 + dx,
                     photo_id=f"fixture-{index}", root=cls.assets)
                     for index, (dy, dx) in enumerate([(0, 0), (0, 0), (.006, .008), (.025, .015), (-.02, -.03)])]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(REPO)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/travel/"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.temporary.cleanup()

    def setUp(self):
        self.contexts = []
        self.errors = []
        self.requests = []

    def tearDown(self):
        for context in self.contexts:
            context.close()
        self.assertEqual(self.errors, [])

    def page(self, photos=None, mobile=False, unavailable=False, animated=False):
        context = self.browser.new_context(viewport={"width": 390 if mobile else 1440, "height": 844 if mobile else 1000},
                                          is_mobile=mobile, has_touch=mobile, reduced_motion="no-preference" if animated else "reduce")
        self.contexts.append(context)
        context.route("https://**/*", lambda route: route.abort())  # The map still works without detail tiles.
        context.route("**/data/photos.json*", lambda route: route.fulfill(status=503) if unavailable else route.fulfill(json={"photos": self.photos if photos is None else photos}))
        context.route("**/travel/photos/**", lambda route: route.fulfill(path=self.assets / route.request.url.split("/travel/")[1]))
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("request", lambda request: self.requests.append(request.url))
        page.goto(self.url)
        page.wait_for_function("window.ATLAS_READY === true")
        return page

    def test_visible_pins_load_thumbnails_and_separate_as_zoom_increases(self):
        page = self.page()
        self.assertFalse(any("/photos/" in url for url in self.requests))
        page.evaluate("void ATLAS_MAP.setView([48.8606, 2.3358], 6, {animate:false})")
        self.assertEqual(page.locator(".photo-pin").count(), 1)
        self.assertEqual(page.locator(".photo-pin-count").inner_text(), "5")
        page.wait_for_function("document.querySelector('.photo-pin img').complete")
        self.assertTrue(all("-thumbnail.webp" in url for url in self.requests if "/photos/" in url))
        page.evaluate("void ATLAS_MAP.setView([48.8606, 2.3358], 13, {animate:false})")
        self.assertEqual(page.locator(".photo-pin").count(), 4)
        self.assertEqual(page.locator(".photo-pin-count").inner_text(), "2")
        page.evaluate("void ATLAS_MAP.setView([0, 0], 13, {animate:false})")
        self.assertEqual(page.locator(".photo-pin").count(), 0)

    def test_group_zoom_then_colocated_photos_have_keyboard_paging(self):
        page = self.page()
        page.evaluate("void ATLAS_MAP.setView([48.8606, 2.3358], 6, {animate:false})")
        page.locator(".photo-pin").click()
        self.assertGreater(page.evaluate("ATLAS_MAP.getZoom()"), 6)
        self.assertEqual(page.locator(".photo-preview-meta").count(), 0)
        page.evaluate("void ATLAS_MAP.setView([48.8606, 2.3358], 13, {animate:false})")
        pin = page.locator(".photo-pin").filter(has=page.locator(".photo-pin-count"))
        pin.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".photo-preview-meta")
        page.get_by_role("button", name="View photo", exact=True).click()
        self.assertTrue(page.locator("#photo-viewer").evaluate("node => node.open"))
        self.assertEqual(page.locator(".photo-counter").inner_text(), "1 / 2")
        page.keyboard.press("ArrowRight")
        self.assertEqual(page.locator("#photo-title").inner_text(), "Fixture 1")
        page.keyboard.press("Escape")
        self.assertFalse(page.locator("#photo-viewer").evaluate("node => node.open"))
        self.assertEqual(page.evaluate("document.activeElement.textContent"), "View photo")
        self.assertFalse(any("-original." in url for url in self.requests))

    def test_mobile_preview_viewer_and_resize_keep_location(self):
        page = self.page(photos=self.photos[:1], mobile=True)
        page.locator("#show-photos").tap()
        page.wait_for_selector(".photo-preview-meta")
        self.assertGreaterEqual(page.evaluate("ATLAS_MAP.getZoom()"), 15)
        popup = page.locator(".photo-popup").bounding_box()
        self.assertGreaterEqual(popup["x"], 0)
        self.assertLessEqual(popup["x"] + popup["width"], 390)
        page.get_by_role("button", name="View photo", exact=True).tap()
        page.wait_for_function("document.querySelector('#photo-viewer img').complete && document.querySelector('#photo-viewer img').naturalWidth > 0")
        box = page.locator("#photo-viewer").bounding_box()
        self.assertLessEqual(box["x"] + box["width"], 390)
        self.assertLessEqual(box["y"] + box["height"], 844)
        page.get_by_role("button", name="Close photo").tap()
        center = page.evaluate("[ATLAS_MAP.getCenter().lat, ATLAS_MAP.getCenter().lng, ATLAS_MAP.getZoom()]")
        page.set_viewport_size({"width": 430, "height": 850})
        page.wait_for_timeout(200)
        after = page.evaluate("[ATLAS_MAP.getCenter().lat, ATLAS_MAP.getCenter().lng, ATLAS_MAP.getZoom()]")
        self.assertEqual(center, after)
        self.assertFalse(any("-original." in url for url in self.requests))

    def test_empty_missing_and_invalid_photo_data_preserve_map(self):
        for photos, unavailable in [([], False), ({"wrong": "shape"}, False), ([{"id": "invalid"}], False), ([], True)]:
            with self.subTest(unavailable=unavailable, photos=photos):
                page = self.page(photos=photos, unavailable=unavailable)
                self.assertTrue(page.locator("#show-photos").is_hidden())
                self.assertEqual(page.locator(".photo-pin").count(), 0)
                self.assertGreater(page.locator(".visited-country").count(), 0)
                self.assertEqual(page.locator("#map-status").inner_text(), "Photos unavailable. Refresh to retry." if unavailable else "")

    def test_animated_photo_selection_finishes_with_preview(self):
        page = self.page(photos=self.photos[:1], animated=True)
        page.locator("#show-photos").click()
        page.wait_for_selector(".photo-preview-meta")
        self.assertGreaterEqual(page.evaluate("ATLAS_MAP.getZoom()"), 15)
        self.assertEqual(page.locator(".photo-preview-meta strong").inner_text(), "Fixture 0")
        page.get_by_role("button", name="World map", exact=True).click()
        page.wait_for_function("ATLAS_MAP.getZoom() < 4")
        self.assertEqual(page.locator(".photo-preview-meta").count(), 0)

    def test_missing_image_assets_keep_pins_and_viewer_usable(self):
        page = self.page(photos=self.photos[:2])
        page.context.route("**/travel/photos/**", lambda route: route.fulfill(status=503))
        page.evaluate("void ATLAS_MAP.setView([48.8606, 2.3358], 13, {animate:false})")
        page.wait_for_selector(".photo-pin-fallback")
        self.assertEqual(page.locator(".photo-pin-count").inner_text(), "2")
        page.locator(".photo-pin").click()
        page.wait_for_selector(".photo-enlarge.photo-missing")
        page.get_by_role("button", name="View photo", exact=True).click()
        page.wait_for_function("document.querySelector('.photo-image-status').textContent.includes('could not load')")
        self.assertEqual(page.locator("#photo-title").inner_text(), "Fixture 0")
        self.assertTrue(page.locator(".photo-original").get_attribute("href").endswith("-original.jpg"))
        page.get_by_role("button", name="Close photo").click()
        self.assertFalse(page.locator("#photo-viewer").evaluate("node => node.open"))


if __name__ == "__main__":
    unittest.main()
