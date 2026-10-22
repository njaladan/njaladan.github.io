import { $$ } from '../../lib/dom.js';
import { escapeHtml } from '../../lib/html.js';
import { AIRPORT_ZOOM, REGIONAL_ZOOM } from './constants.js';
import { allPlaces } from './format.js';
import {
  LABEL_OFFSETS,
  airportCodeRect,
  inside,
  labelRect,
  overlaps,
  squareAround,
  tooltipShift
} from './geometry.js';
import { asButton } from './keyboard.js';

// City and airport labels. Each layout pass places labels greedily, most
// relevant first, wherever they collide with nothing already placed.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */
/** @typedef {import('./context.js').CityMarker} CityMarker */
/** @typedef {import('./geometry.js').Rect} Rect */

// Hidden labels finish fading out before they stop following the map.
const LABEL_FADE_MS = 180;
// Layout waits for a pause in movement, longer while the camera flies.
const LAYOUT_DELAY_MS = 120;
const MOVING_LAYOUT_DELAY_MS = 300;
// City labels appear from this zoom; labels already shown stay a little longer.
const LABEL_ZOOM = 3.6;
const RETAINED_LABEL_ZOOM = 3.35;
// Clearance between labels (px); shown labels may sit a little closer.
const LABEL_GAP = 7;
const RETAINED_LABEL_GAP = 3;
const AIRPORT_CODE_GAP = 3;
// Half the size of the area an airport badge reserves (px).
const AIRPORT_BADGE_HALF = 14;
// Labels keep clear of the map's edges and of the attribution at the bottom.
const EDGE_MARGIN = 8;
const BOTTOM_MARGIN = 25;
const DIRECTIONS = ['right', 'left', 'top', 'bottom'];
const PARK_COLOR = '#648243';
const CITY_COLOR = '#364c60';
// Page controls that labels must not hide.
const CONTROLS = '.map-toolbar,.map-settings-button,#route-legend';

/**
 * A permanent tooltip positioned from a size measured once per layout pass,
 * not interleaved with thousands of marker writes in Leaflet's zoom listeners.
 * @param {any} L
 */
export function createCityTooltip(L) {
  return L.Tooltip.extend({
    _initLayout() {
      L.Tooltip.prototype._initLayout.call(this);
      this.layoutVisible = false;
      this.fadeUntil = 0;
      this.layoutDirection = null;
    },
    setLayoutVisible(visible) {
      if (this.layoutVisible && !visible) this.fadeUntil = performance.now() + LABEL_FADE_MS;
      this.layoutVisible = visible;
      if (visible) this._updatePosition();
      const node = this.getElement();
      node.classList.toggle('label-visible', visible);
      node.setAttribute('aria-hidden', String(!visible));
    },
    _setPosition(point) {
      const fading = performance.now() < (this.fadeUntil || 0);
      if (!this.labelSize || (!this.layoutVisible && !fading)) return;
      const direction = this.options.direction,
        shift = tooltipShift(this.labelSize, direction);
      if (this.layoutDirection !== direction) {
        DIRECTIONS.forEach(value =>
          this._container.classList.toggle(`leaflet-tooltip-${value}`, value === direction)
        );
        this.layoutDirection = direction;
      }
      L.DomUtil.setPosition(
        this._container,
        point
          .subtract(L.point(shift.x, shift.y, true))
          .add(L.point(this.options.offset))
          .add(this._getAnchor())
      );
    }
  });
}

/**
 * Shows a city's label on click or focus, whether or not layout placed it.
 * @param {any} marker
 */
function revealLabel(marker) {
  marker.openTooltip();
  const tooltip = marker.getTooltip(),
    label = tooltip.getElement();
  if (!label) return;
  if (!tooltip.labelSize) {
    tooltip.labelSize = { width: label.offsetWidth, height: label.offsetHeight };
  }
  tooltip.setLayoutVisible(true);
}

/**
 * @param {AtlasContext} ctx
 * @param {import('./format.js').Place} city
 */
function renderCity(ctx, city) {
  const { L } = ctx;
  const marker = L.marker(city.coords, {
    pane: 'cities',
    icon: L.divIcon({
      className: 'city-marker',
      html: `<i style="background:${escapeHtml(city.park ? PARK_COLOR : CITY_COLOR)}"></i>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    })
  })
    .bindTooltip(
      new ctx.CityTooltip({
        permanent: true,
        interactive: true,
        direction: 'right',
        offset: [8, 0],
        className: 'city-label'
      }).setContent(escapeHtml(city.name))
    )
    .addTo(ctx.layers.cities);
  const reveal = () => revealLabel(marker);
  marker.on('click', reveal);
  const node = marker.getElement();
  asButton(node, city.name + (city.park ? ' National park' : ''), reveal);
  node.addEventListener('focus', reveal);
  ctx.layers.cityMarkers.push({ marker, city });
}

/** @param {AtlasContext} ctx */
export function renderCities(ctx) {
  ctx.layers.cities.clearLayers();
  ctx.layers.cityMarkers.length = 0;
  allPlaces().forEach(city => renderCity(ctx, city));
  declutterLabels(ctx);
}

/**
 * Lays labels out once movement pauses.
 * @param {AtlasContext} ctx
 */
export function queueLabelLayout(ctx) {
  const { state } = ctx;
  if (state.labelTimer !== null) return;
  state.labelTimer = setTimeout(
    () => {
      state.labelTimer = null;
      if (ctx.layers.world) declutterLabels(ctx);
    },
    state.cameraMoving ? MOVING_LAYOUT_DELAY_MS : LAYOUT_DELAY_MS
  );
}

/**
 * Whether a point is in view: inside the bounds and, on the globe, on the near side.
 * @param {any} map
 * @param {any} bounds
 * @param {any} latlng
 */
const inView = (map, bounds, latlng) =>
  bounds.contains(latlng) && (!map.isLocationVisible || map.isLocationVisible(latlng));

/**
 * Reserves every airport badge in view, then places codes at regional zoom,
 * busier airports first.
 * @param {AtlasContext} ctx
 * @param {LabelLayout} layout
 */
function layoutAirportLabels(ctx, { root, occupied, bounds, zoom }) {
  const { map } = ctx;
  // The right edge follows the map's own rectangle, not its reported size.
  const box = {
    left: root.left + EDGE_MARGIN,
    right: root.right - EDGE_MARGIN,
    top: root.top + EDGE_MARGIN,
    bottom: root.top + map.getSize().y - BOTTOM_MARGIN
  };
  const markers = ctx.layers.airportMarkers;
  markers.forEach(({ marker }) =>
    marker.getElement().classList.remove('airport-code-visible', 'airport-code-left')
  );
  if (zoom < AIRPORT_ZOOM) return;
  const positions = markers
    .filter(({ marker }) => inView(map, bounds, marker.getLatLng()))
    .map(({ marker }) => {
      const point = map.latLngToContainerPoint(marker.getLatLng());
      return {
        node: marker.getElement(),
        origin: { x: root.left + point.x, y: root.top + point.y }
      };
    });
  positions.forEach(({ origin }) => occupied.push(squareAround(origin, AIRPORT_BADGE_HALF)));
  if (zoom < REGIONAL_ZOOM) return;
  positions.forEach(({ node, origin }) => {
    const left = [false, true].find(side => {
      const rect = airportCodeRect(origin, side);
      if (!inside(rect, box) || occupied.some(other => overlaps(rect, other, AIRPORT_CODE_GAP))) {
        return false;
      }
      occupied.push(rect);
      return true;
    });
    if (left === undefined) return;
    node.classList.add('airport-code-visible');
    node.classList.toggle('airport-code-left', left);
  });
}

/**
 * Cities in view, those of the selected place and those already labelled first.
 * @param {AtlasContext} ctx
 * @param {any} bounds
 * @returns {CityMarker[]}
 */
function visibleCities(ctx, bounds) {
  const { currentCountry, currentState } = ctx.state;
  const visible = ctx.layers.cityMarkers.filter(({ city }) => inView(ctx.map, bounds, city.coords));
  const selected = entry =>
    Number(
      (entry.city.state === currentState && Boolean(currentState)) ||
        entry.city.country === currentCountry
    );
  const wasVisible = entry =>
    Number(Boolean(entry.marker.getTooltip()?.getElement()?.classList.contains('label-visible')));
  return visible.sort((a, b) => selected(b) - selected(a) || wasVisible(b) - wasVisible(a));
}

/**
 * Measures label text in one batch, so placement needs no forced layout per candidate.
 * @param {CityMarker[]} entries
 */
function measureLabels(entries) {
  entries.forEach(entry => {
    if (!entry.marker.isTooltipOpen()) entry.marker.openTooltip();
    const tooltip = entry.marker.getTooltip(),
      node = tooltip.getElement();
    if (node && !entry.labelSize) {
      entry.labelSize = { width: node.offsetWidth, height: node.offsetHeight };
    }
    tooltip.labelSize = entry.labelSize;
  });
}

/**
 * @typedef {object} LabelLayout
 * @property {number} zoom
 * @property {any} bounds The map's geographic bounds.
 * @property {DOMRect} root The map's screen rectangle.
 * @property {Rect} box Where labels may go.
 * @property {Rect[]} occupied Rectangles placed so far.
 */

/**
 * Tries the label's current direction, then each other side, and keeps the
 * first that fits.
 * @param {AtlasContext} ctx
 * @param {CityMarker} entry
 * @param {LabelLayout} layout
 * @param {boolean} retained Whether the label is showing already.
 */
function placeLabel(ctx, { marker, labelSize }, layout, retained) {
  const { L, map } = ctx;
  const tooltip = marker.getTooltip();
  const point = map.latLngToContainerPoint(marker.getLatLng()),
    anchor = L.point(marker.options.icon.options.tooltipAnchor || [0, 0]);
  const origin = { x: layout.root.left + point.x, y: layout.root.top + point.y };
  const gap = retained ? RETAINED_LABEL_GAP : LABEL_GAP;
  const directions = [...new Set([tooltip.options.direction, ...DIRECTIONS])];
  return directions.some(direction => {
    const rect = labelRect({ origin, anchor, direction, size: labelSize });
    if (!inside(rect, layout.box) || layout.occupied.some(other => overlaps(rect, other, gap))) {
      return false;
    }
    if (tooltip.options.direction !== direction) {
      tooltip.options.direction = direction;
      tooltip.options.offset = L.point(...LABEL_OFFSETS[direction]);
      tooltip.update();
    }
    layout.occupied.push(rect);
    return true;
  });
}

/**
 * @param {AtlasContext} ctx
 * @param {CityMarker} entry
 * @param {LabelLayout} layout
 */
function layoutCityLabel(ctx, entry, layout) {
  const tooltip = entry.marker.getTooltip(),
    node = tooltip.getElement();
  if (!node || !entry.labelSize) return;
  const retained = node.classList.contains('label-visible');
  const placed =
    layout.zoom >= (retained ? RETAINED_LABEL_ZOOM : LABEL_ZOOM) &&
    placeLabel(ctx, entry, layout, retained);
  tooltip.setLayoutVisible(placed);
}

/**
 * Places airport codes, city labels and basemap labels without overlaps,
 * keeping clear of page controls and photo pins.
 * @param {AtlasContext} ctx
 */
export function declutterLabels(ctx) {
  const { map } = ctx,
    zoom = map.getZoom(),
    bounds = map.getBounds(),
    size = map.getSize();
  const root = map.getContainer().getBoundingClientRect();
  /** @type {Rect[]} */
  const occupied = $$(CONTROLS)
    .filter(node => !node.hidden)
    .map(node => node.getBoundingClientRect());
  occupied.push(...ctx.photos.occupied());
  /** @type {LabelLayout} */
  const layout = {
    zoom,
    bounds,
    root,
    occupied,
    box: {
      left: root.left + EDGE_MARGIN,
      right: root.left + size.x - EDGE_MARGIN,
      top: root.top + EDGE_MARGIN,
      bottom: root.top + size.y - BOTTOM_MARGIN
    }
  };
  layoutAirportLabels(ctx, layout);
  const visible = visibleCities(ctx, bounds);
  measureLabels(visible);
  ctx.layers.cityMarkers
    .filter(item => !visible.includes(item))
    .forEach(({ marker }) => marker.closeTooltip());
  visible.forEach(entry => layoutCityLabel(ctx, entry, layout));
  ctx.labels.layout(occupied, new Set(visible.map(({ city }) => city.name.toLocaleLowerCase())));
}
