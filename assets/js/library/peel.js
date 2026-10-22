// Pure geometry for peeling a phone page by its corner. The corner is lifted to a point, the page
// folds along the line halfway between the two, and the part past the fold lies over the rest,
// back up. Nothing here touches the DOM.

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {object} Peel
 * @property {Point[]} flat The part of the page still lying flat, in page coordinates.
 * @property {Point[]} lifted The part folded over, before it is reflected; the page beneath shows
 *   through here.
 * @property {string} reflect CSS matrix() that folds the lifted part across the fold line.
 * @property {number} angle CSS gradient angle, in degrees, pointing from the fold toward the corner.
 * @property {number} fold Distance from the start of that gradient to the fold line, in pixels.
 */

/**
 * Pulls `point` back within `radius` of `centre`.
 * @param {Point} point
 * @param {Point} centre
 * @param {number} radius
 * @returns {Point}
 */
function within(point, centre, radius) {
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return point;
  return { x: centre.x + (dx * radius) / distance, y: centre.y + (dy * radius) / distance };
}

/**
 * Keeps a lifted corner where the page could reach while still bound at the spine: no farther
 * from either spine corner than the page itself stretches.
 * @param {Point} lift Where the corner is pulled to.
 * @param {Point} corner The free corner at rest, `{ x: width, y: 0 or height }`.
 * @param {number} height
 * @returns {Point}
 */
export function reachable(lift, corner, height) {
  const width = corner.x;
  const near = within(lift, { x: 0, y: corner.y }, width);
  return within(near, { x: 0, y: height - corner.y }, Math.hypot(width, height));
}

/**
 * The part of a convex polygon on the side of a line where `side(point)` is not negative.
 * @param {Point[]} polygon
 * @param {(point: Point) => number} side
 * @returns {Point[]}
 */
function clip(polygon, side) {
  const kept = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const [here, there] = [side(point), side(next)];
    if (here >= 0) kept.push(point);
    if (here >= 0 !== there >= 0) {
      const t = here / (here - there);
      kept.push({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t });
    }
  });
  return kept;
}

/**
 * How a `width` × `height` page lies with its free `corner` lifted to `lift`.
 * @param {number} width
 * @param {number} height
 * @param {Point} corner
 * @param {Point} lift Already reachable.
 * @returns {Peel | null} Null while the corner is still down.
 */
export function peel(width, height, corner, lift) {
  const dx = lift.x - corner.x;
  const dy = lift.y - corner.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return null;
  // The fold is the perpendicular bisector of corner and lift; `n` points across it, corner to lift.
  const n = { x: dx / length, y: dy / length };
  const middle = { x: (corner.x + lift.x) / 2, y: (corner.y + lift.y) / 2 };
  /** @param {Point} point */
  const side = point => (point.x - middle.x) * n.x + (point.y - middle.y) * n.y;
  const page = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];
  const offset = 2 * (middle.x * n.x + middle.y * n.y);
  const reflect = [
    1 - 2 * n.x * n.x,
    -2 * n.x * n.y,
    -2 * n.x * n.y,
    1 - 2 * n.y * n.y,
    offset * n.x,
    offset * n.y
  ];
  // A CSS gradient runs through the box's centre, as long as the box's extent along it.
  const angle = (Math.atan2(-n.x, n.y) * 180) / Math.PI;
  const span = Math.abs(width * n.x) + Math.abs(height * n.y);
  const centre = { x: width / 2, y: height / 2 };
  const fold = span / 2 + (centre.x - middle.x) * n.x + (centre.y - middle.y) * n.y;
  return {
    flat: clip(page, side),
    lifted: clip(page, point => -side(point)),
    reflect: `matrix(${reflect.map(value => value.toFixed(6)).join(', ')})`,
    angle,
    fold
  };
}

/**
 * A polygon as a CSS clip-path.
 * @param {Point[]} points
 * @returns {string}
 */
export const polygon = points =>
  points.length
    ? `polygon(${points.map(({ x, y }) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})`
    : 'inset(50%)';
