// Pure helpers for the athletics shapes: sports, filtering, SVG markup and draw timing.
// Nothing here touches the DOM.
import { escapeHtml } from '../lib/html.js';

/**
 * A GPS activity, its segments as flat [x, y, x, y, …] runs in a 0–1000 box.
 * @typedef {object} Shape
 * @property {string} date ISO date.
 * @property {string} sport A key of SPORTS.
 * @property {number[][]} segs
 * @property {number} year
 * @property {number} [fit] Stack scale, set by stackFits.
 */

/** @typedef {{ sport: string, year: 'all' | number }} ShapeFilter */

export const SPORTS = {
  run: { label: 'Running', name: 'Run', color: '#c4466e' },
  ride: { label: 'Cycling', name: 'Ride', color: '#1c80b0' },
  foot: { label: 'Hiking & walking', name: 'Walk or hike', color: '#7a9a22' },
  snow: { label: 'Snowboarding', name: 'Snowboard', color: '#6a5fb0' },
  other: { label: 'Other', name: 'Other', color: '#77756f' }
};

// The stack fades each route more as more of them overlap.
const STACK_ALPHA_MIN = 0.05;
const STACK_ALPHA_MAX = 0.6;
const STACK_ALPHA_SCALE = 3.5;

/**
 * Adds each activity's year and shuffles them, so the grid mixes sports and seasons.
 * @param {Array<{ date: string, sport: string, segs: number[][] }>} raw
 * @param {() => number} [random]
 * @returns {Shape[]}
 */
export function prepareShapes(raw, random = Math.random) {
  const shapes = raw.map(s => ({ ...s, year: Number(s.date.slice(0, 4)) }));
  for (let i = shapes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
  }
  return shapes;
}

/**
 * Distinct years, ascending.
 * @param {Shape[]} shapes
 * @returns {number[]}
 */
export const shapeYears = shapes => [...new Set(shapes.map(s => s.year))].sort();

/**
 * @param {Shape[]} shapes
 * @param {ShapeFilter} filter
 * @returns {Shape[]}
 */
export const filterShapes = (shapes, { sport, year }) =>
  shapes.filter(s => (sport === 'all' || s.sport === sport) && (year === 'all' || s.year === year));

/**
 * "June 3, 2024" style date, read at midday so no time zone moves the day.
 * @param {string} iso
 * @param {Intl.DateTimeFormatOptions} [options]
 */
export const formatDate = (iso, options = { month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', options);

/**
 * A segment as a polyline `points` value; coordinates are forced to numbers.
 * @param {number[]} seg
 * @returns {string}
 */
export function pointsAttr(seg) {
  let s = '';
  for (let i = 0; i < seg.length; i += 2) s += `${Number(seg[i])},${Number(seg[i + 1])} `;
  return s;
}

/**
 * @param {string} sport
 * @returns {string}
 */
export const sportColor = sport => SPORTS[sport].color;

/**
 * SVG polylines for every segment of a shape.
 * @param {Shape} shape
 * @returns {string}
 */
export const shapeLines = shape =>
  shape.segs
    .map(
      seg =>
        `<polyline points="${escapeHtml(pointsAttr(seg))}" stroke="${escapeHtml(sportColor(shape.sport))}"/>`
    )
    .join('');

/**
 * A grid cell button for shape `n` of the current list.
 * @param {Shape} shape
 * @param {number} n
 * @returns {string}
 */
export const shapeCell = (shape, n) =>
  `<button type="button" class="shape-cell" data-n="${escapeHtml(n)}" aria-label="${escapeHtml(`${SPORTS[shape.sport].name}, ${formatDate(shape.date)}`)}"><svg viewBox="-60 -60 1120 1120" aria-hidden="true">${shapeLines(shape)}</svg></button>`;

/**
 * Start and end markers for the viewer: a hollow dot where the route begins, and a filled one,
 * hidden until the line reaches it, where it ends.
 * @param {Shape} shape
 * @returns {string}
 */
export function shapeEnds(shape) {
  const first = shape.segs[0];
  const last = shape.segs[shape.segs.length - 1];
  const [x0, y0] = [first[0], first[1]].map(Number);
  const [x1, y1] = [last[last.length - 2], last[last.length - 1]].map(Number);
  return (
    `<circle cx="${x0}" cy="${y0}" r="16" fill="#faf8f3" stroke="#272724" stroke-width="5"/>` +
    `<circle class="shape-end" cx="${x1}" cy="${y1}" r="14" fill="#272724" opacity="0"/>`
  );
}

/**
 * One chip button; sport chips (other than "all") carry a colour swatch.
 * @param {{ key: string | number, text: string, swatch: boolean }} chip
 * @returns {string}
 */
export function chipButton({ key, text, swatch }) {
  const dot =
    swatch && key !== 'all'
      ? `<span class="shape-swatch" style="background:${escapeHtml(sportColor(String(key)))}"></span>`
      : '';
  return `<button type="button" aria-pressed="${key === 'all'}">${dot}${escapeHtml(text)}</button>`;
}

/** Share of routes that keep their size in the stack; the rest shrink to stay in frame. */
const STACK_FIT_SHARE = 0.99;

/**
 * Sets each shape's `fit`: how much to scale it about the box centre for the stack.
 * Routes are sized by their spread (RMS distance from the centre), not their extent, so
 * their far ends land at different places instead of all meeting the same edge and
 * looking cut off. One zoom keeps 99% of routes whole; the long, thin rest shrink until
 * they fit the box too.
 * @param {Shape[]} shapes
 */
export function stackFits(shapes) {
  const sized = shapes.map(s => {
    let sum = 0;
    let n = 0;
    let ext = 0;
    for (const seg of s.segs) {
      for (let i = 0; i < seg.length; i += 2) {
        const dx = seg[i] - 500;
        const dy = seg[i + 1] - 500;
        sum += dx * dx + dy * dy;
        n++;
        ext = Math.max(ext, Math.abs(dx), Math.abs(dy));
      }
    }
    return { s, rms: Math.sqrt(sum / (n || 1)) || 1, ext: ext || 1 };
  });
  const ratios = sized.map(({ rms, ext }) => ext / rms).sort((a, b) => a - b);
  const zoom = 500 / (ratios[Math.floor(STACK_FIT_SHARE * (ratios.length - 1))] || 1);
  for (const { s, rms, ext } of sized) s.fit = Math.min(zoom / rms, 500 / ext);
}

/**
 * Line opacity for a stack of `count` routes.
 * @param {number} count
 */
export const stackAlpha = count =>
  Math.max(STACK_ALPHA_MIN, Math.min(STACK_ALPHA_MAX, STACK_ALPHA_SCALE / Math.sqrt(count || 1)));

/**
 * Splits `duration` across segments by length, so the pen moves at one speed.
 * @param {number[]} lengths
 * @param {number} duration
 * @returns {Array<{ delay: number, share: number }>}
 */
export function drawSchedule(lengths, duration) {
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let delay = 0;
  return lengths.map(length => {
    const share = (length / total) * duration;
    const step = { delay, share };
    delay += share;
    return step;
  });
}
