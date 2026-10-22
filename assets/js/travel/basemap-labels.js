import { largestRing } from './ui/geo.js';
import {
  collides,
  compareLabels,
  fitsFeature,
  inZoomBand,
  insideView,
  labelRect
} from './ui/label-layout.js';

// Background country, state and city names under the atlas's own markers,
// placed each frame by priority so they never overlap.

const LABEL_PANE_Z_INDEX = 390;
// Hidden labels keep updating positions until their fade-out ends (ms).
const LABEL_FADE_MS = 180;
// Features drawn as separate overseas parts that get no label of their own.
const UNLABELLED_FEATURES = ['010', '250-overseas'];

/**
 * @typedef {import('./ui/label-layout.js').LabelKind} LabelKind
 * @typedef {import('./ui/label-layout.js').Rect} Rect
 * @typedef {{marker: any, name: string, kind: LabelKind, rank: number, bounds: any,
 *   extent: number, visible?: boolean, size?: {width: number, height: number}}} Label
 */

/**
 * A marker class whose hidden labels still take part in collision placement,
 * but need no DOM position writes on each fractional zoom. Exit fades finish first.
 * @param {any} L
 */
function labelMarkerClass(L) {
  return L.Marker.extend({
    update() {
      if (this.layoutVisible || performance.now() < (this.fadeUntil || 0)) {
        L.Marker.prototype.update.call(this);
      }
      return this;
    },
    setLayoutVisible(visible) {
      if (visible === Boolean(this.layoutVisible)) return;
      if (!visible) this.fadeUntil = performance.now() + LABEL_FADE_MS;
      this.layoutVisible = visible;
      if (visible) this.update();
      this.getElement().classList.toggle('label-visible', visible);
    }
  });
}

/**
 * Whether a label can show in this view, before checking collisions.
 * @param {any} map
 * @param {Label} label
 * @param {{zoom: number, bounds: any, visitedNames: Set<string>}} view
 * @param {boolean} retained
 */
function eligible(map, label, { zoom, bounds, visitedNames }, retained) {
  const coords = label.marker.getLatLng();
  if (!bounds.contains(coords)) return false;
  if (map.isLocationVisible && !map.isLocationVisible(coords)) return false;
  // Visited places carry the atlas's own, more prominent labels.
  if (visitedNames.has(label.name.toLocaleLowerCase())) return false;
  return inZoomBand(label, zoom, retained);
}

/**
 * The label's screen rectangle if it fits in view and inside its feature.
 * @param {any} map
 * @param {Label} label
 * @param {{root: DOMRect, size: {x: number, y: number}}} view
 * @param {boolean} retained
 * @returns {Rect | null}
 */
function placement(map, label, { root, size }, retained) {
  const rect = labelRect(map.latLngToContainerPoint(label.marker.getLatLng()), label.size, root);
  if (label.bounds) {
    const southWest = map.latLngToContainerPoint(label.bounds.getSouthWest());
    const northEast = map.latLngToContainerPoint(label.bounds.getNorthEast());
    const span = { x: northEast.x - southWest.x, y: northEast.y - southWest.y };
    if (!fitsFeature(rect, span, retained)) return null;
  }
  return insideView(rect, root, size) ? rect : null;
}

/**
 * Shows the labels that fit, in priority order, around already occupied space.
 * @param {any} map
 * @param {Label[]} labels
 * @param {Rect[]} occupied rectangles to avoid; placed labels are added
 * @param {Set<string>} visitedNames lower-cased names the atlas labels itself
 */
function layoutLabels(map, labels, occupied, visitedNames) {
  const view = {
    zoom: map.getZoom(),
    bounds: map.getBounds(),
    root: map.getContainer().getBoundingClientRect(),
    size: map.getSize(),
    visitedNames
  };
  labels.forEach(label => {
    if (!label.size) {
      const node = label.marker.getElement().firstChild;
      label.size = { width: node.offsetWidth, height: node.offsetHeight };
    }
  });
  [...labels].sort(compareLabels).forEach(label => {
    const retained = Boolean(label.visible);
    const rect = eligible(map, label, view, retained)
      ? placement(map, label, view, retained)
      : null;
    const show = Boolean(rect) && !collides(rect, occupied, retained);
    if (show) occupied.push(rect);
    label.visible = show;
    label.marker.setLayoutVisible(show);
  });
}

/**
 * Adds the basemap label layer.
 * @param {any} map Leaflet map or the globe renderer
 */
export function installBasemapLabels(map) {
  const L = map.atlasRenderer || window.L;
  map.createPane('backgroundLabels');
  const pane = map.getPane('backgroundLabels');
  pane.style.zIndex = LABEL_PANE_Z_INDEX;
  pane.style.pointerEvents = 'none';
  /** @type {Label[]} */
  const labels = [];
  const LabelMarker = labelMarkerClass(L);
  map.on('resize', () =>
    labels.forEach(label => {
      delete label.size;
    })
  );

  /**
   * @param {string} name
   * @param {any} coords
   * @param {{kind: LabelKind, rank?: number, bounds?: any}} options
   */
  function add(name, coords, { kind, rank = 0, bounds = null }) {
    const marker = new LabelMarker(coords, {
      pane: 'backgroundLabels',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: `background-label background-${kind}-label`,
        html: '<span></span>',
        iconSize: [0, 0]
      })
    }).addTo(map);
    marker.getElement().firstChild.textContent = name;
    const extent = bounds ? bounds.getNorthEast().distanceTo(bounds.getSouthWest()) : 0;
    labels.push({ marker, name, kind, rank, bounds, extent });
  }

  /**
   * Labels each feature at the centre of its largest polygon.
   * @param {any[]} features GeoJSON features
   * @param {LabelKind} kind
   */
  function geography(features, kind) {
    features.forEach(feature => {
      if (UNLABELLED_FEATURES.includes(feature.id)) return;
      const ring = largestRing(feature.geometry);
      if (!ring?.length) return;
      const bounds = L.latLngBounds(ring.map(([lon, lat]) => [lat, lon]));
      add(feature.properties.name, bounds.getCenter(), { kind, bounds });
    });
  }

  return {
    geography,
    cities: cities =>
      cities.forEach(city => add(city.name, city.coords, { kind: 'city', rank: city.rank })),
    layout: (occupied, visitedNames) => layoutLabels(map, labels, occupied, visitedNames)
  };
}
