// Groups photos into map pins by screen distance. Side-effect free.

// Pins stay clear of the map edges, the toolbar and the bottom controls (px).
const PIN_MARGIN = { side: 30, top: 80, bottom: 45 };
// Pins are spaced further apart in the overview than at city zooms (px).
const OVERVIEW_SPACING = 38;
const DETAIL_SPACING = 32;
export const DETAIL_ZOOM = 8;

/** @typedef {{x: number, y: number}} Point */

/**
 * @template P
 * @typedef {{point: Point, items: P[], order: number}} Cluster
 */

/**
 * Minimum screen distance between pins at a zoom.
 * @param {number} zoom
 */
export const photoSpacing = zoom => (zoom < DETAIL_ZOOM ? OVERVIEW_SPACING : DETAIL_SPACING);

/**
 * Whether a container point leaves room for a pin.
 * @param {Point} point
 * @param {Point} size container size
 */
export const pinFits = (point, size) =>
  point.x >= PIN_MARGIN.side &&
  point.x <= size.x - PIN_MARGIN.side &&
  point.y >= PIN_MARGIN.top &&
  point.y <= size.y - PIN_MARGIN.bottom;

/**
 * The earliest cluster within `spacing` of a point, searching neighbouring cells.
 * @template P
 * @param {Map<string, Cluster<P>[]>} cells
 * @param {Point} point
 * @param {number} spacing
 * @returns {Cluster<P> | null}
 */
function nearbyCluster(cells, point, spacing) {
  const x = Math.floor(point.x / spacing),
    y = Math.floor(point.y / spacing);
  let nearby = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      // Choose in photo order, independent of the camera-relative grid cells.
      // Crossing a cell edge must not send a print to a different stack.
      (cells.get(`${x + dx},${y + dy}`) || []).forEach(group => {
        const close = Math.hypot(group.point.x - point.x, group.point.y - point.y) < spacing;
        if (close && (!nearby || group.order < nearby.order)) nearby = group;
      });
    }
  }
  return nearby;
}

/**
 * Greedy clustering in photo order: each photo joins the earliest cluster
 * started within `spacing` pixels, or starts its own.
 * @template {{coords: number[]}} P
 * @param {P[]} photos
 * @param {{project: (coords: number[]) => Point, size: Point, spacing: number,
 *   isVisible?: (coords: number[]) => boolean}} view
 * @returns {Cluster<P>[]}
 */
export function clusterPhotos(photos, { project, size, spacing, isVisible = () => true }) {
  /** @type {Cluster<P>[]} */
  const groups = [];
  const cells = new Map();
  photos.forEach(photo => {
    if (!isVisible(photo.coords)) return;
    const point = project(photo.coords);
    if (!pinFits(point, size)) return;
    const nearby = nearbyCluster(cells, point, spacing);
    if (nearby) {
      nearby.items.push(photo);
      return;
    }
    const group = { point, items: [photo], order: groups.length };
    groups.push(group);
    const key = `${Math.floor(point.x / spacing)},${Math.floor(point.y / spacing)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(group);
  });
  return groups;
}
