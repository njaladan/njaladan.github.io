// Vector layers. Polylines draw as SVG over the canvas; polygons paint in
// WebGL (see style-sync.js) and keep SVG paths only as hit targets.
import { bindDOM, bindings, pathData } from './bindings.js';
import { lineFade } from './flight-geometry.js';
import { projectLine, projectPolygon, simplify } from './paths.js';

const base = window.L;
const NS = 'http://www.w3.org/2000/svg';
// Leaflet's path defaults.
const DEFAULT_COLOR = '#3388ff';
const DEFAULT_WEIGHT = 3;
// Flat flight lines fade in to this opacity unless styled otherwise.
const FLIGHT_OPACITY = 0.43;
// Recorded routes are too fine to read below this Leaflet zoom.
const ROUTE_MIN_ZOOM = 3;

export const Polyline = base.Polyline.extend({
  ...bindings,
  ...pathData,
  initialize(coords, options) {
    this._atlasGeometry = coords;
    base.Polyline.prototype.initialize.call(this, coords, options);
  },
  onAdd(map) {
    this._path = document.createElementNS(NS, 'path');
    this._path.classList.add('leaflet-interactive');
    if (this.options.className) {
      this._path.classList.add(...this.options.className.split(/\s+/).filter(Boolean));
    }
    map.getSVG(this.options.pane || 'overlayPane').append(this._path);
    bindDOM(this, this._path);
    if (this.options.pane === 'flights') {
      this._flightIndex = map._flightLines.length;
      map._flightLines.push(this);
    }
    this.setStyle(this.options);
    this.update();
  },
  onRemove() {
    this.closeTooltip();
    this.closePopup();
    this._path?.remove();
  },
  getElement() {
    return this._path;
  },
  setStyle(options) {
    Object.assign(this.options, options);
    if (this._path) {
      this._path.setAttribute('fill', 'none');
      this._path.setAttribute('stroke', this.options.color || DEFAULT_COLOR);
      this._path.setAttribute('stroke-width', this.options.weight || DEFAULT_WEIGHT);
      this._path.setAttribute('stroke-opacity', this.options.opacity ?? 1);
      this._path.style.pointerEvents = this.options.interactive === false ? 'none' : 'stroke';
      // Raised flights in WebGL mirror their flat line's style.
      if (this.options.pane === 'flights') {
        this._map?._flightLayer?.setStyle(this._flightIndex, this.options);
      }
    }
    return this;
  },
  bringToFront() {
    if (this._path) this._path.parentNode?.append(this._path);
    return this;
  },
  update() {
    if (!this._map || !this._path) return this;
    const map = this._map,
      flight = this.options.pane === 'flights';
    const visible = flight ? lineFade(map.nativeMap.getZoom()) : 1;
    if (this._culled(visible)) {
      this._parts = [];
      this._setPath('');
      return this;
    }
    const cache = this.options.pane === 'routes' ? map._pathCache : null;
    const cached = cache?.get(this._atlasGeometry);
    if (cached) {
      this._parts = cached.parts;
      this._setPath(cached.path);
      return this;
    }
    const segments = simplify(
      this._atlasGeometry,
      Array.isArray(this._latlngs[0]) ? this._latlngs : [this._latlngs],
      map.nativeMap.getZoom()
    );
    const projected = projectLine(map, segments);
    this._parts = projected.parts;
    this._setPath(projected.path);
    cache?.set(this._atlasGeometry, projected);
    if (flight) {
      this._path.style.strokeOpacity = String(visible * (this.options.opacity ?? FLIGHT_OPACITY));
      this._path.style.pointerEvents = visible > 0.5 ? 'stroke' : 'none';
    }
    return this;
  },
  // Invisible hit lines are not needed mid-gesture, and raised flights draw
  // in WebGL until the flat lines fade in. Neither needs projecting then.
  _culled(visible) {
    const map = this._map;
    const hitOnly = this.options.opacity === 0 && map._moving;
    return (
      !visible ||
      hitOnly ||
      (this.options.pane === 'routes' && map.getZoom() < ROUTE_MIN_ZOOM) ||
      !this.getBounds().intersects(map.getBounds())
    );
  }
});

export const Polygon = base.Polygon.extend({
  ...bindings,
  ...pathData,
  onAdd(map) {
    map._polygons.add(this);
    this._path = document.createElementNS(NS, 'path');
    this._path.setAttribute('class', `leaflet-interactive ${this.options.className || ''}`);
    this._path.setAttribute('fill', 'transparent');
    this._path.setAttribute('stroke', 'none');
    this._path.style.pointerEvents = this.options.interactive === false ? 'none' : 'fill';
    map.getSVG(this.options.pane || 'overlayPane').append(this._path);
    bindDOM(this, this._path);
    this.update();
    map.queueStyle(true);
  },
  onRemove(map) {
    this.closePopup();
    this.closeTooltip();
    map._polygons.delete(this);
    this._path?.remove();
    map.queueStyle(true);
  },
  getElement() {
    return this._path;
  },
  setStyle(style) {
    Object.assign(this.options, style);
    this._map?.queueStyle(true);
    return this;
  },
  update() {
    if (!this._path || !this._map) return;
    const pane = this._map.getPane(this.options.pane || 'overlayPane');
    // Geographic paint lives in WebGL. SVG exists only for hit targets, so
    // invisible states need no vertex projection while the world rotates.
    // Hit areas are also skipped mid-gesture and rebuilt when the camera stops.
    if (
      this.options.interactive === false ||
      this._map._moving ||
      pane.hidden ||
      pane.style.pointerEvents === 'none' ||
      !this.getBounds().intersects(this._map.getBounds())
    ) {
      this._setPath('');
      return;
    }
    this._setPath(projectPolygon(this._map, this.feature.geometry));
  }
});
