// Screen and map geometry for the atlas. Pure functions with no DOM access.

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Rect */
/** @typedef {{ width: number, height: number }} Size */
/** @typedef {'right' | 'left' | 'top' | 'bottom'} Direction */

/**
 * Fraction 0–1 of the way from `start` across `span`, clamped.
 * @param {number} value
 * @param {number} start
 * @param {number} span
 */
export const ramp = (value, start, span) => Math.max(0, Math.min(1, (value - start) / span));

/**
 * Splits a track wherever consecutive points are more than `maxGap` apart,
 * dropping pieces too short to draw.
 * @param {number[][]} segment
 * @param {(a: number[], b: number[]) => number} distance
 * @param {number} maxGap
 * @returns {number[][][]}
 */
export function splitAtGaps(segment, distance, maxGap) {
  const parts = [];
  let current = [];
  segment.forEach(point => {
    if (current.length && distance(current[current.length - 1], point) > maxGap) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push(point);
  });
  if (current.length > 1) parts.push(current);
  return parts;
}

/**
 * The place closest to `coords`, if it is within `maxDistance`.
 * @template {{ coords: number[] }} P
 * @param {number[]} coords
 * @param {P[]} places
 * @param {(a: number[], b: number[]) => number} distance
 * @param {number} maxDistance
 * @returns {P | null}
 */
export function nearestPlace(coords, places, distance, maxDistance) {
  let best = null,
    nearest = Infinity;
  places.forEach(place => {
    const d = distance(coords, place.coords);
    if (d < nearest) {
      nearest = d;
      best = place;
    }
  });
  return nearest < maxDistance ? best : null;
}

/** @template T @param {T[]} points @returns {T} The middle point of a path. */
export const middlePoint = points => points[Math.floor(points.length / 2)];

/**
 * How far to scroll so a span starting at `start` fits inside `extent`,
 * keeping `near` and `far` margins. Zero when it already fits.
 * @param {number} start
 * @param {number} size
 * @param {number} extent
 * @param {{ near: number, far: number }} margins
 */
export function overflowShift(start, size, extent, { near, far }) {
  if (start + size > extent - far) return start + size - extent + far;
  if (start < near) return start - near;
  return 0;
}

/**
 * True when two rectangles come closer than `gap`.
 * @param {Rect} a
 * @param {Rect} b
 * @param {number} gap
 */
export const overlaps = (a, b, gap) =>
  a.left < b.right + gap &&
  a.right + gap > b.left &&
  a.top < b.bottom + gap &&
  a.bottom + gap > b.top;

/**
 * @param {Rect} rect
 * @param {Rect} box
 */
export const inside = (rect, box) =>
  rect.left >= box.left &&
  rect.right <= box.right &&
  rect.top >= box.top &&
  rect.bottom <= box.bottom;

/**
 * @param {{ x: number, y: number }} center
 * @param {number} half
 * @returns {Rect}
 */
export const squareAround = (center, half) => ({
  left: center.x - half,
  right: center.x + half,
  top: center.y - half,
  bottom: center.y + half
});

/** Tooltip offsets from the marker, per label direction. */
export const LABEL_OFFSETS = { right: [8, 0], left: [-8, 0], top: [0, -6], bottom: [0, 6] };
// Leaflet adds its own 6px gap on the side the tooltip points from.
const TOOLTIP_GAPS = { right: [6, 0], left: [-6, 0], top: [0, -6], bottom: [0, 6] };

/**
 * Share of a label's extent that sits before its anchor on one axis: all of it
 * when the label extends towards `before`, none towards `after`, else half.
 * @param {string} direction
 * @param {string} before
 * @param {string} after
 */
function anchorShare(direction, before, after) {
  if (direction === before) return 1;
  if (direction === after) return 0;
  return 0.5;
}

/**
 * Where a tooltip's top-left corner sits relative to its anchor point.
 * @param {Size} size
 * @param {string} direction
 * @returns {{ x: number, y: number }}
 */
export const tooltipShift = (size, direction) => ({
  x: size.width * anchorShare(direction, 'left', 'right'),
  y: size.height * anchorShare(direction, 'top', 'bottom')
});

/**
 * The screen rectangle a city label would cover in `direction`.
 * @param {{ origin: { x: number, y: number }, anchor: { x: number, y: number },
 *   direction: Direction, size: Size }} label
 * @returns {Rect}
 */
export function labelRect({ origin, anchor, direction, size }) {
  const [offsetX, offsetY] = LABEL_OFFSETS[direction],
    [gapX, gapY] = TOOLTIP_GAPS[direction];
  const left =
    origin.x +
    offsetX +
    anchor.x +
    gapX -
    Math.round(size.width * anchorShare(direction, 'left', 'right'));
  const top =
    origin.y +
    offsetY +
    anchor.y +
    gapY -
    Math.round(size.height * anchorShare(direction, 'top', 'bottom'));
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/**
 * @param {{ x: number, y: number }} origin The airport's screen point.
 * @param {boolean} left Whether the code sits left of the badge.
 * @returns {Rect}
 */
export function airportCodeRect(origin, left) {
  const x = origin.x + (left ? -58 : 18),
    y = origin.y - 11;
  return { left: x, right: x + 40, top: y, bottom: y + 22 };
}

/**
 * Validates `?lat=&lng=&zoom=` deep-link parameters.
 * @param {string} search
 * @param {{ zoom: number, minZoom: number, maxZoom: number }} limits
 * @returns {{ lat: number, lng: number, zoom: number } | null}
 */
export function parseViewParams(search, { zoom, minZoom, maxZoom }) {
  const params = new URLSearchParams(search);
  if (!params.has('lat') || !params.has('lng')) return null;
  const lat = Number(params.get('lat')),
    lng = Number(params.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const requested = Number(params.get('zoom')) || zoom;
  return { lat, lng, zoom: Math.max(minZoom, Math.min(maxZoom, requested)) };
}

const polygonsOf = geometry =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

/**
 * Clips a ring to one side of a meridian, adding points where it crosses.
 * @param {number[][]} ring
 * @param {number} edge
 * @param {(lon: number) => boolean} keep
 */
function clipRing(ring, edge, keep) {
  const result = [];
  ring.forEach((point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length];
    if (keep(previous[0]) !== keep(point[0])) {
      const t = (edge - previous[0]) / (point[0] - previous[0]);
      result.push([edge, previous[1] + t * (point[1] - previous[1])]);
    }
    if (keep(point[0])) result.push(point);
  });
  return result;
}

/**
 * Makes a ring's longitudes continuous across the dateline and drops its
 * closing point.
 * @param {number[][]} ring
 */
function unwrapRing(ring) {
  let longitude = ring[0][0];
  return ring.slice(0, -1).map(([lon, lat]) => {
    let next = lon;
    while (next - longitude > 180) next -= 360;
    while (next - longitude < -180) next += 360;
    longitude = next;
    return [next, lat];
  });
}

/**
 * Cuts an unwrapped polygon into one piece per 360° world copy it spans.
 * @param {number[][][]} rings
 * @returns {number[][][][]}
 */
function worldCopies(rings) {
  const pieces = [];
  const longitudes = rings[0].map(point => point[0]);
  const first = Math.floor((Math.min(...longitudes) + 180) / 360),
    last = Math.floor((Math.max(...longitudes) + 180) / 360);
  for (let part = first; part <= last; part++) {
    const west = -180 + part * 360,
      east = 180 + part * 360;
    const clipped = rings.map(ring =>
      clipRing(
        clipRing(ring, west, lon => lon >= west),
        east,
        lon => lon <= east
      )
    );
    if (clipped[0].length < 3) continue;
    pieces.push(
      clipped
        .filter(ring => ring.length >= 3)
        .map(ring => {
          const shifted = ring.map(([lon, lat]) => [lon - part * 360, lat]);
          return [...shifted, shifted[0]];
        })
    );
  }
  return pieces;
}

// Russia and Fiji cross the dateline.
const DATELINE_COUNTRIES = ['643', '242'];

/**
 * Splits dateline crossings so a flat map does not draw them across the world.
 * @param {any} feature A GeoJSON country feature.
 */
export function splitDateline(feature) {
  if (!DATELINE_COUNTRIES.includes(String(feature.id))) return feature;
  const pieces = polygonsOf(feature.geometry).flatMap(polygon =>
    worldCopies(polygon.map(unwrapRing))
  );
  return { ...feature, geometry: { type: 'MultiPolygon', coordinates: pieces } };
}

/**
 * Separates metropolitan France from its overseas regions, which were not visited.
 * @param {any} feature A GeoJSON country feature.
 * @returns {any[]}
 */
export function scopeFrance(feature) {
  if (String(feature.id) !== '250') return [feature];
  const polygons = polygonsOf(feature.geometry);
  const metropolitan = polygons.filter(polygon =>
    polygon[0].every(([lon, lat]) => lon >= -6 && lon <= 10 && lat >= 40 && lat <= 52)
  );
  const overseas = polygons.filter(polygon => !metropolitan.includes(polygon));
  return [
    { ...feature, geometry: { type: 'MultiPolygon', coordinates: metropolitan } },
    {
      ...feature,
      id: '250-overseas',
      properties: { name: 'France (overseas)' },
      geometry: { type: 'MultiPolygon', coordinates: overseas }
    }
  ];
}
