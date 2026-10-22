// Collision layout rules for basemap labels. Side-effect free.

/**
 * @typedef {'country' | 'state' | 'city'} LabelKind
 * @typedef {{left: number, right: number, top: number, bottom: number, width: number, height: number}} Rect
 * @typedef {{kind: LabelKind, rank: number, bounds?: unknown, extent: number, visible?: boolean}} LabelOrder
 */

// Countries claim space first, then states, then cities.
const KIND_ORDER = { country: 0, state: 1, city: 2 };
// Zoom bands where each kind of label may appear.
const COUNTRY_MAX_ZOOM = 7;
const STATE_ZOOMS = [4.5, 8];
const CITY_MIN_ZOOM = 5;
// Each step down in city rank needs this much more zoom.
const CITY_RANK_ZOOM = 0.6;
// Shown labels linger past a band edge and hidden ones wait before entering,
// so labels don't flicker while zooming across a boundary.
const RETAIN_SLACK = 0.15;
const ENTER_SLACK = -0.1;
// Clearances (px). Shown labels keep their place with smaller margins.
const VIEW_MARGIN = 8;
const VIEW_BOTTOM_MARGIN = 30;
const FEATURE_PAD = { retained: { x: 10, y: 6 }, entering: { x: 18, y: 10 } };
const LABEL_GAP = { retained: 4, entering: 8 };

/**
 * Placement order: by kind, then larger features, then rank, keeping shown labels first.
 * @param {LabelOrder} a
 * @param {LabelOrder} b
 */
export function compareLabels(a, b) {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.bounds && b.bounds) return b.extent - a.extent;
  return a.rank - b.rank || Number(Boolean(b.visible)) - Number(Boolean(a.visible));
}

/**
 * Whether a label belongs at this zoom.
 * @param {{kind: LabelKind, rank: number}} label
 * @param {number} zoom
 * @param {boolean} retained currently shown
 */
export function inZoomBand({ kind, rank }, zoom, retained) {
  const slack = retained ? RETAIN_SLACK : ENTER_SLACK;
  if (kind === 'country') return zoom <= COUNTRY_MAX_ZOOM + slack;
  if (kind === 'state') return zoom >= STATE_ZOOMS[0] - slack && zoom <= STATE_ZOOMS[1] + slack;
  return zoom >= CITY_MIN_ZOOM + rank * CITY_RANK_ZOOM - slack;
}

/**
 * Screen rectangle of a label centred on a container point.
 * @param {{x: number, y: number}} point container point
 * @param {{width: number, height: number}} size
 * @param {{left: number, top: number}} origin container's page offset
 * @returns {Rect}
 */
export function labelRect(point, size, origin) {
  return {
    left: origin.left + point.x - size.width / 2,
    right: origin.left + point.x + size.width / 2,
    top: origin.top + point.y - size.height / 2,
    bottom: origin.top + point.y + size.height / 2,
    ...size
  };
}

/**
 * Whether a feature spans enough screen space for its label.
 * @param {Rect} rect
 * @param {{x: number, y: number}} span feature's on-screen extent
 * @param {boolean} retained
 */
export function fitsFeature(rect, span, retained) {
  const pad = retained ? FEATURE_PAD.retained : FEATURE_PAD.entering;
  return Math.abs(span.x) >= rect.width + pad.x && Math.abs(span.y) >= rect.height + pad.y;
}

/**
 * Whether a label stays clear of the viewport edges and the bottom controls.
 * @param {Rect} rect
 * @param {{left: number, top: number}} origin
 * @param {{x: number, y: number}} size container size
 */
export function insideView(rect, origin, size) {
  return (
    rect.left >= origin.left + VIEW_MARGIN &&
    rect.right <= origin.left + size.x - VIEW_MARGIN &&
    rect.top >= origin.top + VIEW_MARGIN &&
    rect.bottom <= origin.top + size.y - VIEW_BOTTOM_MARGIN
  );
}

/**
 * Whether a label collides with any placed rectangle.
 * @param {Rect} rect
 * @param {Rect[]} occupied
 * @param {boolean} retained
 */
export function collides(rect, occupied, retained) {
  const gap = retained ? LABEL_GAP.retained : LABEL_GAP.entering;
  return occupied.some(
    other =>
      rect.left < other.right + gap &&
      rect.right + gap > other.left &&
      rect.top < other.bottom + gap &&
      rect.bottom + gap > other.top
  );
}
