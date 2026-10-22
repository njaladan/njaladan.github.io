// Pure page arithmetic for the open book: how the notes split into pages and spreads,
// and how a turning page curls. Nothing here touches the DOM.

/** Strips a turning page is cut into. */
export const STRIPS = 10;
// How far ahead of the spine the free edge leads (and later trails) the turn.
const CURL_LEAD = 0.22;
// Darkest shading on a strip seen edge-on.
const MAX_SHADE = 0.28;

/**
 * Pages in a run of columns `width` wide, `step` apart, that is `scrollWidth` long.
 * @param {number} scrollWidth
 * @param {number} width
 * @param {number} step
 * @returns {number}
 */
export const pageCountFor = (scrollWidth, width, step) =>
  Math.max(1, Math.round((scrollWidth + step - width) / step));

/**
 * A spread's first leaf turns with the cover, so spreads need one leading leaf; a phone needs none.
 * @param {number} pageCount
 * @param {boolean} single One page at a time.
 * @returns {{ lead: number, lastSpread: number }}
 */
export const spreadLayout = (pageCount, single) =>
  single
    ? { lead: 0, lastSpread: pageCount - 1 }
    : { lead: 1, lastSpread: Math.floor((pageCount - 1) / 2) };

/**
 * Page numbers (zero-based) on a leaf's front and back; out-of-range numbers are blank.
 * @param {number} index Leaf index.
 * @param {boolean} single
 * @returns {[number, number]}
 */
export const leafPages = (index, single) =>
  single ? [index, Infinity] : [index * 2 - 1, index * 2];

/**
 * @param {number} target
 * @param {number} lastSpread
 * @returns {number}
 */
export const clampSpread = (target, lastSpread) => Math.max(0, Math.min(lastSpread, target));

/**
 * The "3–4 of 9" label for a spread.
 * @param {number} spread
 * @param {number} pageCount
 * @param {boolean} single
 * @returns {string}
 */
export function folioText(spread, pageCount, single) {
  const first = single ? spread + 1 : spread * 2 + 1;
  const last = single ? first : Math.min(pageCount, spread * 2 + 2);
  return `${first === last ? first : `${first}–${last}`} of ${pageCount}`;
}

/**
 * Cubic ease-in-out.
 * @param {number} t 0–1.
 * @returns {number}
 */
export const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Absolute rotation of one strip at time `t` of a turn. Strips nearer the free edge run ahead
 * early on and behind later, which bends the page.
 * @param {number} t 0–1.
 * @param {number} index Strip index, 0 at the spine.
 * @param {boolean} turned Turning onto the left-hand pile.
 * @returns {number} Degrees.
 */
export function stripAngle(t, index, turned) {
  const reach = (index + 0.5) / STRIPS;
  const progress = ease(
    Math.min(1, Math.max(0, t + CURL_LEAD * reach * Math.sin(2 * Math.PI * t)))
  );
  return -180 * (turned ? progress : 1 - progress);
}

/**
 * Shade for a strip at `angle`, darkest edge-on.
 * @param {number} angle Degrees.
 * @returns {string}
 */
export const stripShade = angle =>
  (MAX_SHADE * (1 - Math.abs(Math.cos((angle * Math.PI) / 180)))).toFixed(3);

/**
 * Strip boundaries across a page, rounded so slices line up with the settled page.
 * @param {number} width
 * @returns {number[]}
 */
export const stripEdges = width =>
  Array.from({ length: STRIPS + 1 }, (_, index) => Math.round((index * width) / STRIPS));

// A held page bends toward its free edge: strips nearer the edge are this far ahead of the spine.
const HOLD_LEAD = 0.35;
const HOLD_SEARCH_STEPS = 24;

/**
 * Absolute strip angles for a page held `hold` of the way through a turn (0 flat on its own side,
 * 1 flat on the other); the strips toward the free edge lead.
 * @param {number} hold 0–1.
 * @param {boolean} turned Turning onto the left-hand pile.
 * @returns {number[]} Degrees, from the spine outward.
 */
export function heldAngles(hold, turned) {
  return Array.from({ length: STRIPS }, (_, index) => {
    const lag = HOLD_LEAD * (1 - (index + 1) / STRIPS);
    const k = Math.min(1, Math.max(0, (hold - lag) / (1 - HOLD_LEAD)));
    const angle = 90 * (1 - Math.cos(Math.PI * k));
    return turned ? -angle : angle - 180;
  });
}

/**
 * Where a held page's free edge falls, as a share of the page width right of the spine.
 * @param {number[]} angles From heldAngles.
 * @returns {number} From -1 (flat on the left) to 1 (flat on the right).
 */
export const edgeOf = angles =>
  angles.reduce((x, angle) => x + Math.cos((angle * Math.PI) / 180), 0) / angles.length;

/**
 * How far through the turn a page is when its free edge sits under the finger.
 * @param {number} edge Finger position, as a share of the page width right of the spine.
 * @param {boolean} turned
 * @returns {number} 0–1.
 */
export function holdFor(edge, turned) {
  // The edge moves steadily one way as the hold grows, so halve the range toward it.
  let [low, high] = [0, 1];
  for (let step = 0; step < HOLD_SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    const past = edgeOf(heldAngles(middle, turned));
    if (turned ? past > edge : past < edge) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
