// Pure helpers for wheel and gesture zoom. Side-effect free.

// Pixels per line for WheelEvent.DOM_DELTA_LINE deltas.
const WHEEL_LINE_PX = 16;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Pixels per unit of a wheel event's delta.
 * @param {number} deltaMode WheelEvent.deltaMode
 * @param {number} pageHeight pixels in one DOM_DELTA_PAGE step
 * @returns {number}
 */
export function wheelUnit(deltaMode, pageHeight) {
  if (deltaMode === 1) return WHEEL_LINE_PX;
  if (deltaMode === 2) return pageHeight;
  return 1;
}

/**
 * Offset of a scaled photo along one axis: centred while it fits, otherwise
 * kept so no gap opens at either edge of the viewport.
 * @param {number} offset requested translation
 * @param {number} size viewport size
 * @param {number} photoSize unscaled, letterboxed photo size
 * @param {number} scale
 * @returns {number}
 */
export function constrainOffset(offset, size, photoSize, scale) {
  const gap = (size - photoSize) / 2;
  return photoSize * scale <= size
    ? (size * (1 - scale)) / 2
    : clamp(offset, size - scale * (gap + photoSize), -scale * gap);
}

/**
 * Offset that keeps `point` fixed while scaling by `ratio`.
 * @param {number} point
 * @param {number} offset
 * @param {number} ratio
 */
export const anchoredOffset = (point, offset, ratio) => point + (offset - point) * ratio;

/**
 * Midpoint and spread of up to two pointers.
 * @param {{x: number, y: number}[]} points
 * @returns {{point: {x: number, y: number}, distance: number}}
 */
export function pinch(points) {
  if (points.length < 2) return { point: points[0], distance: 0 };
  const [a, b] = points;
  return {
    point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(a.x - b.x, a.y - b.y)
  };
}

/**
 * Displayed size of a photo letterboxed into a box.
 * @param {{width: number, height: number}} box
 * @param {number} ratio photo width / height
 */
export function containSize(box, ratio) {
  const width = Math.min(box.width, box.height * ratio);
  return { width, height: width / ratio };
}
