// Renderer adapter for the atlas's existing layer/camera contract. Application
// state, cards, photos, labels, settings and itineraries stay in the shared app.
// Leaflet supplies geometry utilities and layer base classes; it does not create
// a second map here. MapLibre owns the camera, globe, basemap and 3D flights.
// The pieces live in ./globe/: layers, popups, camera, style sync and spin.
import { readSetting } from '../lib/storage.js';
import { Group, Tile, geoJSON } from './globe/groups.js';
import { GlobeMap } from './globe/map.js';
import { Marker } from './globe/marker.js';
import { Popup, Tooltip } from './globe/popups.js';
import { Polygon, Polyline } from './globe/vectors.js';

const renderer = Object.assign({}, window.L, {
  Marker,
  Tooltip,
  Popup,
  Polyline,
  Polygon,
  TileLayer: Tile,
  map: (id, options) => new GlobeMap(id, options),
  marker: (coords, options) => new Marker(coords, options),
  polyline: (coords, options) => new Polyline(coords, options),
  popup: options => new Popup(options),
  layerGroup: layers => new Group(layers),
  tileLayer: (url, options) => new Tile(url, options),
  geoJSON
});

/**
 * Whether this browser can draw the globe: MapLibre loaded and WebGL works.
 * @returns {boolean}
 */
function webGLAvailable() {
  if (typeof maplibregl === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// The globe is the default view. Visitors can choose the flat Leaflet map
// in settings, and browsers without WebGL fall back to it.
/** Whether the globe view can run here. */
export const globeSupported = webGLAvailable();
/** The globe renderer, or null when the flat Leaflet map should be used. */
export const globeRenderer =
  globeSupported && readSetting('atlas-map-view') !== 'flat' ? renderer : null;
