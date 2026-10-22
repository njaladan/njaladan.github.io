// A Leaflet-shaped map backed by MapLibre. Layers keep Leaflet's lifecycle
// (onAdd, update, onRemove); the map re-projects them on each camera frame
// and mirrors panes, polygons and tiles into the MapLibre style.
import { createGlobeFlights } from './flights.js';
import { camera, homeView } from './camera.js';
import { sunLight } from './math.js';
import { startSpin, stopSpin } from './spin.js';
import { syncStyle } from './style-sync.js';

const base = window.L;
const NS = 'http://www.w3.org/2000/svg';
const stamp = base.Util.stamp;
// The sun moves a quarter degree in a minute; refresh its light every ten.
const SUN_UPDATE_MS = 6e5;
const MAX_PIXEL_RATIO = 1.5;
const OCEAN = '#dfe6e8';
const SKY = '#faf8f3';
// Leaflet's pane z-indexes for the panes MapLibre's canvas would otherwise cover.
const PANE_Z = { tooltipPane: '650', markerPane: '600' };
const CAMERA_EVENTS = [
  'movestart',
  'move',
  'moveend',
  'zoomstart',
  'zoom',
  'zoomend',
  'dragstart',
  'resize'
];
// Smooth zoom announces its own gesture boundaries (see _moveStart).
const MANUAL_EVENTS = ['movestart', 'moveend', 'zoomstart', 'zoomend'];
// Clicks on these belong to an overlay, not the map.
const OVERLAY_SELECTOR =
  '.leaflet-marker-icon,.leaflet-interactive,.leaflet-popup,.leaflet-tooltip';

/**
 * MapLibre options: a blank ocean that bends from globe to Mercator as the
 * camera zooms in, lit from the real sun.
 * @param {string} id container element id
 */
const nativeOptions = id => ({
  container: id,
  ...homeView(),
  minZoom: 0,
  maxZoom: 16,
  maxPitch: 0,
  attributionControl: false,
  pixelRatio: Math.min(devicePixelRatio, MAX_PIXEL_RATIO),
  canvasContextAttributes: { antialias: false },
  style: {
    version: 8,
    sky: {
      'sky-color': SKY,
      'horizon-color': SKY,
      'fog-color': '#fff',
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.15, 4, 0.15, 6, 0]
    },
    light: sunLight(),
    projection: {
      type: ['interpolate', ['linear'], ['zoom'], 3, 'vertical-perspective', 6, 'mercator']
    },
    sources: {},
    layers: [{ id: 'atlas-ocean', type: 'background', paint: { 'background-color': OCEAN } }]
  }
});

export const GlobeMap = base.Evented.extend({
  ...camera,
  initialize(id, options) {
    this.options = options;
    this._container = document.getElementById(id);
    this._container.classList.add('leaflet-container', 'atlas-globe');
    this._container.tabIndex = 0;
    this._layers = {};
    this._panes = {};
    this._svgs = {};
    this._polygons = new Set();
    this._tiles = new Set();
    this._flightLines = [];
    this._dirtyData = true;
    this._frame = null;
    this._styleFrame = null;
    this._manual = false;
    this._removed = false;
    this._abort = new AbortController();
    this.nativeMap = new maplibregl.Map(nativeOptions(id));
    this._setupPanes();
    this._setupAttribution();
    this.ready = new Promise(resolve => {
      this.nativeMap.once('load', () => {
        this._loaded = true;
        this.queueStyle(true);
        this.queueRender();
        resolve();
      });
    });
    this.ready.then(() => this.spin());
    this._sunTimer = setInterval(() => this.nativeMap.setLight(sunLight()), SUN_UPDATE_MS);
    CAMERA_EVENTS.forEach(type => this.nativeMap.on(type, event => this._onCamera(type, event)));
    this._setupClicks();
  },
  _setupPanes() {
    this._overlayRoot = document.createElement('div');
    this._overlayRoot.className = 'leaflet-map-pane atlas-overlay-root';
    this.nativeMap.getCanvasContainer().append(this._overlayRoot);
    for (const pane of ['overlayPane', 'markerPane', 'tooltipPane', 'popupPane']) {
      this.createPane(pane);
    }
    for (const [name, z] of Object.entries(PANE_Z)) this.getPane(name).style.zIndex = z;
    // Only panes the application creates later are observed for restyling.
    this._paneObserver = new MutationObserver(() => this.queueStyle());
  },
  _setupAttribution() {
    this._attributions = new Set();
    this._attribution = new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'MapLibre'
    });
    this.nativeMap.addControl(this._attribution);
    this.attributionControl = {
      setPrefix() {},
      addAttribution: text => {
        this._attributions.add(text);
        this._attribution.options.customAttribution = [...this._attributions];
        this._attribution._updateAttributions();
      }
    };
  },
  _setupClicks() {
    this.nativeMap.on('click', event => {
      if (!event.originalEvent.target.closest(OVERLAY_SELECTOR)) this.closePopup();
      this.fire('click', {
        latlng: base.latLng(event.lngLat.lat, event.lngLat.lng),
        originalEvent: event.originalEvent
      });
    });
    this._container.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Escape' &&
          this._popup &&
          this._popup.options.closeOnEscapeKey !== false
        ) {
          event.stopPropagation();
          this.closePopup();
        }
      },
      { signal: this._abort.signal }
    );
  },
  _onCamera(type, event) {
    this._boundsCache = null;
    if (type === 'resize') this._sizeCache = null;
    if (type === 'movestart' || type === 'moveend') this._setMoving(type === 'movestart');
    // MapLibre fires move inside the frame it is about to draw. Placing the
    // overlay now keeps it on that frame; a queued update trails by one.
    if (type === 'move') this.renderNow();
    else if (type !== 'zoom') this.queueRender();
    if (!this._manual || !MANUAL_EVENTS.includes(type)) this.fire(type, event);
  },
  // Leaflet's animation flags, which the shared application reads.
  _setMoving(moving) {
    this._panAnim = { _inProgress: moving };
    this._flyToFrame = moving ? 1 : null;
    this._moving = moving;
  },
  createPane(name) {
    if (this._panes[name]) return this._panes[name];
    const pane = document.createElement('div');
    pane.className = `leaflet-pane leaflet-${name.replace(/Pane$/, '')}-pane`;
    pane.dataset.atlasPane = name;
    this._overlayRoot.append(pane);
    this._panes[name] = pane;
    this._paneObserver?.observe(pane, { attributes: true, attributeFilter: ['style', 'hidden'] });
    return pane;
  },
  getPane(name) {
    return this._panes[name] || this.createPane(name);
  },
  getSVG(name) {
    if (!this._svgs[name]) {
      const svg = document.createElementNS(NS, 'svg');
      svg.classList.add('atlas-vector-pane');
      this.getPane(name).append(svg);
      this._svgs[name] = svg;
    }
    return this._svgs[name];
  },
  getContainer() {
    return this._container;
  },
  getSize() {
    return (this._sizeCache ||= base.point(
      this._container.clientWidth,
      this._container.clientHeight
    ));
  },
  addLayer(layer) {
    const id = stamp(layer);
    if (this._layers[id]) return this;
    this._layers[id] = layer;
    layer._map = this;
    layer.onAdd?.(this);
    layer.fire('add');
    return this;
  },
  removeLayer(layer) {
    const id = stamp(layer);
    if (!this._layers[id]) return this;
    delete this._layers[id];
    layer._map = null;
    layer.onRemove?.(this);
    layer.fire('remove');
    return this;
  },
  hasLayer(layer) {
    return Boolean(this._layers[stamp(layer)]);
  },
  eachLayer(fn) {
    Object.values(this._layers).forEach(fn);
    return this;
  },
  closePopup(popup = this._popup) {
    if (popup) this.removeLayer(popup);
    return this;
  },
  _moveStart() {
    this._manual = true;
    this.fire('movestart');
    this.fire('zoomstart');
    return this;
  },
  _move(coords, zoom) {
    this.setView(coords, zoom);
    return this;
  },
  _moveEnd() {
    this._manual = false;
    this.fire('zoomend');
    this.fire('moveend');
    return this;
  },
  // The app settles its own zoom gestures here; that must not end the idle spin.
  installSmoothZoom() {
    return {
      finish: () => {
        // Undefined until the spin starts, and null between turns.
        if (this._spinTarget == null) this.nativeMap.stop();
      }
    };
  },
  queueRender() {
    if (this._frame !== null || this._removed) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.renderNow();
    });
  },
  renderNow() {
    if (this._removed) return;
    // Routes, outlines and click targets share their input coordinates.
    // Project and clip that geometry once for this camera frame.
    this._pathCache = new WeakMap();
    Object.values(this._layers).forEach(layer => layer.update?.());
    this._pathCache = null;
  },
  queueStyle(data = false) {
    this._dirtyData ||= data;
    if (!this._loaded || this._styleFrame !== null || this._removed) return;
    this._styleFrame = requestAnimationFrame(() => {
      this._styleFrame = null;
      this.syncStyle();
    });
  },
  syncStyle() {
    syncStyle(this);
  },
  configureFlights(log) {
    let hovered = null;
    const line = route => this._flightLines[log.routes.indexOf(route)];
    this._flightLayer = createGlobeFlights(log, {
      onHover: (route, coords) => {
        const next = route ? line(route) : null;
        if (next === hovered) return;
        hovered?.fire('mouseout');
        hovered = next;
        hovered?.fire('mouseover', { latlng: base.latLng(coords.lat, coords.lng) });
      },
      onSelect: (route, coords) => line(route)?.openPopup(base.latLng(coords.lat, coords.lng))
    });
    this.nativeMap.addLayer(this._flightLayer);
  },
  spin() {
    startSpin(this);
  },
  stopSpin() {
    stopSpin(this);
  },
  remove() {
    clearInterval(this._sunTimer);
    this.stopSpin();
    this._removed = true;
    this.fire('unload');
    this._paneObserver.disconnect();
    cancelAnimationFrame(this._frame);
    cancelAnimationFrame(this._styleFrame);
    this._abort.abort();
    Object.values(this._layers).forEach(layer => this.removeLayer(layer));
    this.nativeMap.remove();
    return this;
  }
});
