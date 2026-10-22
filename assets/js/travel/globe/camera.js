// Leaflet's camera and projection API on top of MapLibre's camera. Leaflet
// zooms count 256-pixel tiles and MapLibre's count 512, so they differ by one.
const base = window.L;
const point = base.point,
  latLng = base.latLng;

/** Leaflet zoom minus MapLibre zoom. */
export const ZOOM_OFFSET = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 17;
// Bounds this wide and tall are the whole world, shown from the home view.
const WORLD_SPAN = { lng: 350, lat: 130 };
// Default animation lengths, in seconds.
const FLY_SECONDS = 1.1;
const FIT_SECONDS = 1.25;
const PAN_SECONDS = 0.3;
// Narrow screens see the whole globe from further out.
const NARROW_SCREEN = 700;

/**
 * The opening camera, in MapLibre terms.
 * @returns {{ center: number[], zoom: number }}
 */
export const homeView = () => ({
  center: [10, 25],
  zoom: innerWidth < NARROW_SCREEN ? 1.05 : 1.95
});

/**
 * Milliseconds for an animated move, honouring Leaflet's animate and duration.
 * @param {{ animate?: boolean, duration?: number }} options
 * @param {number} seconds default duration
 * @returns {number}
 */
const duration = (options, seconds) =>
  options.animate === false ? 0 : (options.duration || seconds) * 1000;

/** Camera mixin for the GlobeMap. */
export const camera = {
  getCenter() {
    const c = this.nativeMap.getCenter();
    return latLng(c.lat, c.lng);
  },
  getZoom() {
    return this.nativeMap.getZoom() + ZOOM_OFFSET;
  },
  getMinZoom() {
    return MIN_ZOOM;
  },
  getMaxZoom() {
    return MAX_ZOOM;
  },
  getZoomScale(to, from = this.getZoom()) {
    return 2 ** (to - from);
  },
  getScaleZoom(scale, from = this.getZoom()) {
    return from + Math.log2(scale);
  },
  getBounds() {
    if (!this._boundsCache) {
      const b = this.nativeMap.getBounds();
      this._boundsCache = base.latLngBounds([
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()]
      ]);
    }
    return this._boundsCache;
  },
  getBoundsZoom(bounds, inside, padding = [0, 0]) {
    const box = base.latLngBounds(bounds);
    const size = this.getSize().subtract(point(padding));
    const extent = base
      .bounds([this.project(box.getNorthWest(), 0), this.project(box.getSouthEast(), 0)])
      .getSize();
    const scale = (inside ? Math.max : Math.min)(size.x / extent.x, size.y / extent.y);
    return Math.max(this.getMinZoom(), Math.min(this.getMaxZoom(), this.getScaleZoom(scale, 0)));
  },
  isLocationVisible(coords) {
    const at = latLng(coords);
    return !this.nativeMap.transform.isLocationOccluded(new maplibregl.LngLat(at.lng, at.lat));
  },
  // With a zoom, projects in Leaflet's flat Web Mercator pixels; without one,
  // to the current view's container pixels.
  project(coords, zoom) {
    const at = latLng(coords);
    if (zoom !== undefined) return base.CRS.EPSG3857.latLngToPoint(at, zoom);
    const p = this.nativeMap.project([at.lng, at.lat]);
    return point(p.x, p.y);
  },
  unproject(p, zoom) {
    const at = point(p);
    if (zoom !== undefined) return base.CRS.EPSG3857.pointToLatLng(at, zoom);
    const coords = this.nativeMap.unproject([at.x, at.y]);
    return latLng(coords.lat, coords.lng);
  },
  // There is no separate layer pane offset: layer and container points agree.
  latLngToLayerPoint(coords) {
    return this.project(coords);
  },
  latLngToContainerPoint(coords) {
    return this.project(coords);
  },
  layerPointToContainerPoint(p) {
    return point(p);
  },
  containerPointToLayerPoint(p) {
    return point(p);
  },
  containerPointToLatLng(p) {
    return this.unproject(p);
  },
  layerPointToLatLng(p) {
    return this.unproject(p);
  },
  mouseEventToContainerPoint(event) {
    const box = this._container.getBoundingClientRect();
    return point(event.clientX - box.left, event.clientY - box.top);
  },
  setView(coords, zoom = this.getZoom()) {
    const at = latLng(coords);
    this.nativeMap.jumpTo({ center: [at.lng, at.lat], zoom: zoom - ZOOM_OFFSET });
    return this;
  },
  setZoom(zoom) {
    return this.setView(this.getCenter(), zoom);
  },
  flyTo(coords, zoom, options = {}) {
    const at = latLng(coords);
    this.nativeMap.flyTo({
      center: [at.lng, at.lat],
      zoom: zoom - ZOOM_OFFSET,
      duration: duration(options, FLY_SECONDS)
    });
    return this;
  },
  fitBounds(bounds, options = {}) {
    const box = base.latLngBounds(bounds);
    if (
      box.getEast() - box.getWest() > WORLD_SPAN.lng &&
      box.getNorth() - box.getSouth() > WORLD_SPAN.lat
    ) {
      const target = homeView();
      if (options.animate) {
        this.nativeMap.flyTo({ ...target, duration: (options.duration || FIT_SECONDS) * 1000 });
      } else {
        this.nativeMap.jumpTo(target);
      }
      return this;
    }
    const tl = point(options.paddingTopLeft || options.padding || [0, 0]),
      br = point(options.paddingBottomRight || options.padding || [0, 0]);
    // Use the atlas's continuous Mercator pixel scale for destination fits.
    // A fit calculated in the in-between globe projection can overshoot its
    // requested zoom and padding when the camera lands in Mercator.
    const zoom = Math.min(options.maxZoom ?? MAX_ZOOM, this.getBoundsZoom(box, false, tl.add(br)));
    const center = this.unproject(
      this.project(box.getSouthWest(), zoom)
        .add(this.project(box.getNorthEast(), zoom))
        .divideBy(2)
        .add(br.subtract(tl).divideBy(2)),
      zoom
    );
    return options.animate === false
      ? this.setView(center, zoom)
      : this.flyTo(center, zoom, options);
  },
  flyToBounds(bounds, options) {
    return this.fitBounds(bounds, { ...options, animate: true });
  },
  panBy(offset, options = {}) {
    const by = point(offset);
    this.nativeMap.panBy([by.x, by.y], {
      duration: duration(options, PAN_SECONDS),
      easing: t => 1 - (1 - t) ** 3
    });
    return this;
  },
  stop() {
    this.nativeMap.stop();
    return this;
  }
};
