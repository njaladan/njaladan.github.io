"""Browser checks using temporary photo data; no sample visits are published."""
import functools
import importlib.util
import os
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
        site = Path(os.environ.get("SITE_BUILD_DIR", REPO / "_site"))
        if not (site / "travel/index.html").exists():
            raise unittest.SkipTest("Build the site with Jekyll before running browser checks")
        cls.temporary = tempfile.TemporaryDirectory()
        cls.assets = Path(cls.temporary.name)
        source = cls.assets / "fixture.jpg"
        Image.new("RGB", (1600, 1000), "#837e68").save(source)
        cls.photos = [importer.import_photo(source, place=f"Fixture {index}", lat=48.8606 + dy, lon=2.3358 + dx,
                     photo_id=f"fixture-{index}", root=cls.assets)
                     for index, (dy, dx) in enumerate([(0, 0), (0, 0), (.006, .008), (.025, .015), (-.02, -.03)])]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(site)))
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

    def page(self, photos=None, mobile=False, unavailable=False, animated=False, missing_assets=False, flights=None):
        context = self.browser.new_context(viewport={"width": 390 if mobile else 1440, "height": 844 if mobile else 1000},
                                          is_mobile=mobile, has_touch=mobile, reduced_motion="no-preference" if animated else "reduce")
        self.contexts.append(context)
        context.route("https://**/*", lambda route: route.abort())  # The map still works without detail tiles.
        context.route("**/data/photos.json*", lambda route: route.fulfill(status=503) if unavailable else route.fulfill(json={"photos": self.photos if photos is None else photos}))
        context.route("**/travel/photos/**", lambda route: route.fulfill(status=503) if missing_assets else route.fulfill(path=self.assets / route.request.url.split("/travel/")[1]))
        if flights is not None:
            context.route("**/data/flights.json*", lambda route: route.fulfill(json=flights))
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("request", lambda request: self.requests.append(request.url))
        page.goto(self.url)
        page.wait_for_function("window.ATLAS_READY === true")
        return page

    def test_visible_pins_load_thumbnails_and_separate_as_zoom_increases(self):
        page = self.page()
        self.assertEqual(page.locator(".photo-pin").count(), 1)
        self.assertEqual(page.locator(".photo-pin-count").inner_text(), "5")
        page.evaluate("void ATLAS_MAP.setZoom(ATLAS_MAP.getMinZoom(), {animate:false})")
        self.assertEqual(page.locator(".photo-pin").count(), 1)
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
        page.locator(".photo-pin").tap()
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

    def test_heic_original_link_preserves_pin_preview_and_webp_viewer(self):
        photo = {**self.photos[0], "original": {"src": "photos/fixture-0/source-original.heic", "bytes": 100}}
        page = self.page(photos=[photo], mobile=True)
        page.locator(".photo-pin").tap()
        page.get_by_role("button", name="View photo", exact=True).tap()
        page.wait_for_function("document.querySelector('#photo-viewer img').complete && document.querySelector('#photo-viewer img').naturalWidth > 0")
        self.assertEqual(page.locator(".photo-original").get_attribute("href"), photo["original"]["src"])
        self.assertEqual(page.locator(".photo-original").get_attribute("download"), "fixture-0-original.heic")
        self.assertFalse(any(url.endswith(".heic") for url in self.requests))

    def test_world_overview_keeps_separate_photo_groups_on_desktop_and_mobile(self):
        photos = [{**photo, "coords": coords} for photo, coords in zip(self.photos, [
            [48.86, 2.34], [22.32, 114.17], [-50.94, -73.41], [64.15, -21.94]])]
        for mobile in (False, True):
            with self.subTest(mobile=mobile):
                page = self.page(photos=photos, mobile=mobile)
                page.evaluate("void ATLAS_MAP.setZoom(ATLAS_MAP.getMinZoom(), {animate:false})")
                self.assertGreaterEqual(page.locator(".photo-pin").count(), 2)
                page.wait_for_function("[...document.querySelectorAll('.photo-pin img')].every(img => img.complete && img.naturalWidth > 0)")
                self.assertTrue(all("-thumbnail.webp" in url for url in self.requests if "/photos/" in url))

    def test_country_focus_allows_dragging_and_selecting_another_country(self):
        page = self.page(photos=[])
        france = page.locator('.visited-country[aria-label="France"]')
        france.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("location.hash === '#country=250' && ATLAS_MAP.getZoom() > 5")
        self.assertEqual(page.title(), "Travel — Ganesh")
        self.assertGreater(page.locator('.visited-country[tabindex="0"]').count(), 15)
        self.assertEqual(page.locator('.tiny-country').count(), 2)
        before = page.evaluate("[ATLAS_MAP.getCenter().lat, ATLAS_MAP.getCenter().lng]")
        page.mouse.move(950, 600)
        page.mouse.down()
        page.mouse.move(1100, 700, steps=12)
        page.mouse.up()
        page.wait_for_function("before => Math.abs(ATLAS_MAP.getCenter().lng - before[1]) > .001", arg=before)
        page.evaluate("void ATLAS_MAP.setView([47, 8], 6, {animate:false})")
        point = page.evaluate("() => {const p = ATLAS_MAP.latLngToContainerPoint([46.8, 8]), r = document.querySelector('#map').getBoundingClientRect(); return {x: p.x + r.left, y: p.y + r.top};}")
        self.assertEqual(page.evaluate("p => document.elementFromPoint(p.x, p.y).getAttribute('aria-label')", point), "Switzerland")
        page.mouse.click(point["x"], point["y"])
        page.wait_for_function("location.hash === '#country=756'")
        page.locator('.visited-country[aria-label="Netherlands"]').focus()
        page.keyboard.press("Enter")
        page.wait_for_function("location.hash === '#country=528'")
        focus = page.evaluate("[ATLAS_MAP.getCenter().lat, ATLAS_MAP.getCenter().lng]")
        page.evaluate("void ATLAS_MAP.panBy([100, 0], {animate:false})")
        page.locator('.visited-country[aria-label="Netherlands"]').focus()
        page.keyboard.press("Enter")
        after = page.evaluate("[ATLAS_MAP.getCenter().lat, ATLAS_MAP.getCenter().lng]")
        self.assertAlmostEqual(focus[0], after[0], places=5)
        self.assertAlmostEqual(focus[1], after[1], places=5)
        self.assertGreater(page.locator('.activity-route').count(), 0)
        page.locator('#back-world').click()
        page.wait_for_function("location.hash === '' && ATLAS_MAP.getZoom() < 3")

    def test_country_deep_link_keeps_routes_and_other_countries_available(self):
        page = self.page(photos=[])
        page.goto(self.url + "#country=250")
        page.wait_for_function("window.ATLAS_READY === true && ATLAS_MAP.getZoom() > 5")
        self.assertGreater(page.locator('.activity-route').count(), 0)
        self.assertGreater(page.locator('.transport-route').count(), 0)
        self.assertEqual(page.title(), "Travel — Ganesh")
        page.locator('.visited-country[aria-label="Iceland"]').focus()
        page.keyboard.press("Enter")
        page.wait_for_function("location.hash === '#country=352'")

    def test_empty_missing_and_invalid_photo_data_preserve_map(self):
        for photos, unavailable in [([], False), ({"wrong": "shape"}, False), ([{"id": "invalid"}], False), ([], True)]:
            with self.subTest(unavailable=unavailable, photos=photos):
                page = self.page(photos=photos, unavailable=unavailable)
                self.assertEqual(page.locator(".photo-pin").count(), 0)
                self.assertGreater(page.locator(".visited-country").count(), 0)
                self.assertEqual(page.locator("#map-status").inner_text(), "Photos unavailable. Refresh to retry." if unavailable else "")

    def test_animated_photo_selection_finishes_with_preview(self):
        page = self.page(photos=self.photos[:1], animated=True)
        page.locator(".photo-pin").click()
        page.wait_for_selector(".photo-preview-meta")
        self.assertGreaterEqual(page.evaluate("ATLAS_MAP.getZoom()"), 15)
        self.assertEqual(page.locator(".photo-preview-meta strong").inner_text(), "Fixture 0")
        page.get_by_role("button", name="World map", exact=True).click()
        page.wait_for_function("ATLAS_MAP.getZoom() < 4")
        self.assertEqual(page.locator(".photo-preview-meta").count(), 0)

    def test_missing_image_assets_keep_pins_and_viewer_usable(self):
        page = self.page(photos=self.photos[:2], missing_assets=True)
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

    def test_dashes_follow_recorded_flight_direction_and_round_trips(self):
        airports = {code: {"coords": coords, "name": code, "city": code} for code, coords in
                    [("AAA", [0, 0]), ("BBB", [0, 20]), ("CCC", [20, 20]), ("DDD", [20, 0])]}
        flights = [{"number": "Test", "from": origin, "to": destination, "duration_s": 3600}
                   for origin, destination in [("AAA", "BBB"), ("CCC", "AAA"), ("AAA", "DDD"), ("DDD", "AAA")]]
        routes = [{"airports": ["AAA", destination], "flights": records,
                   "segments": [[airports["AAA"]["coords"], airports[destination]["coords"]]]}
                  for destination, records in [("BBB", [0]), ("CCC", [1]), ("DDD", [2, 3])]]
        page = self.page(photos=[], animated=True, flights={"airports": airports, "flights": flights, "routes": routes})
        page.evaluate("void ATLAS_MAP.setView([46.5, 8.5], 6, {animate:false})")
        for selector in [".activity-route", ".transport-route", ".flight-route", ".leaflet-routes-pane path"]:
            self.assertGreater(page.locator(selector).count(), 0)
            self.assertTrue(page.locator(selector).evaluate_all("nodes => nodes.every(node => getComputedStyle(node).strokeDasharray !== 'none' && node.getAnimations().length === 1)"))

        def offsets(node, times):
            return node.evaluate("""(node, times) => {
                const animation = node.getAnimations()[0];
                animation.pause();
                return times.map(time => {
                    animation.currentTime = time;
                    return parseFloat(getComputedStyle(node).strokeDashoffset);
                });
            }""", times)

        forward = page.locator('.flight-route[aria-label="AAA ↔ BBB"]')
        reverse = page.locator('.flight-route[aria-label="AAA ↔ CCC"]')
        both = page.locator('.flight-route[aria-label="AAA ↔ DDD"]')
        start, end = offsets(forward, [0, 600])
        self.assertLess(end, start)
        start, end = offsets(reverse, [0, 600])
        self.assertGreater(end, start)
        start, middle, end = offsets(both, [0, 12000, 24000])
        self.assertLess(middle, start)
        self.assertGreater(end, middle)
        trip = page.locator('.transport-route[aria-label="Train: Tokyo ↔ Odawara · Round trip"]')
        start, middle, end = offsets(trip, [0, 12000, 24000])
        self.assertLess(middle, start)
        self.assertGreater(end, middle)
        reverse.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".flight-popup")
        self.assertEqual(reverse.evaluate("node => getComputedStyle(node).strokeDasharray"), "4px, 5px")
        self.assertEqual(reverse.evaluate("node => node.getAnimations().length"), 1)

    def test_reduced_motion_keeps_dashed_routes_still_and_updates_live(self):
        page = self.page(photos=[], animated=True)
        page.emulate_media(reduced_motion="reduce")
        self.assertTrue(page.locator(".route-flow").evaluate_all("nodes => nodes.every(node => getComputedStyle(node).strokeDasharray !== 'none' && node.getAnimations().length === 0)"))
        page.emulate_media(reduced_motion="no-preference")
        self.assertTrue(page.locator(".route-flow").evaluate_all("nodes => nodes.every(node => node.getAnimations().length === 1)"))


if __name__ == "__main__":
    unittest.main()
