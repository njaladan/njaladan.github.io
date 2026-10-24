// Manhattan street coverage: decoding the published tracks and the arithmetic behind
// the animation, kept free of the DOM so it can be tested.

/** @typedef {[number, number]} Point */

/**
 * @typedef {object} Piece One unbroken run of points, in canvas pixels.
 * @property {Point[]} xy
 * @property {number[]} at Distance along the piece at each point.
 * @property {number} off Distance along the whole track where the piece starts.
 */

/**
 * Undoes the delta encoding written by the coverage pipeline: the first pair is
 * absolute and every later pair is relative to the one before.
 * @param {number[]} deltas
 * @returns {number[]}
 */
export function decodeDeltas(deltas) {
  const out = new Array(deltas.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/**
 * Turns decoded pieces into measured paths, with `toPx` mapping data units to pixels.
 * @param {number[][]} pieces
 * @param {(x: number, y: number) => Point} toPx
 * @returns {{ pieces: Piece[], length: number }}
 */
export function measurePieces(pieces, toPx) {
  let off = 0;
  const out = pieces.map(flat => {
    const xy = [];
    const at = [];
    for (let i = 0; i < flat.length; i += 2) {
      const p = toPx(flat[i], flat[i + 1]);
      const prev = xy[xy.length - 1];
      at.push(prev ? at[at.length - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 0);
      xy.push(p);
    }
    const piece = { xy, at, off };
    off += at[at.length - 1] || 0;
    return piece;
  });
  return { pieces: out, length: off };
}

/**
 * @param {Point} a
 * @param {Point} b
 * @param {number} f
 * @returns {Point}
 */
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/**
 * The points of one piece between distances `lo` and `hi` along it, cut exactly at both ends.
 * @param {Piece} piece
 * @param {number} lo
 * @param {number} hi
 * @returns {Point[]}
 */
export function slicePiece({ xy, at }, lo, hi) {
  const pts = [];
  for (let i = 0; i < xy.length; i++) {
    const before = i > 0 ? at[i - 1] : at[0];
    const step = at[i] - before || 1;
    if (i > 0 && before < lo && at[i] > lo) pts.push(lerp(xy[i - 1], xy[i], (lo - before) / step));
    if (at[i] >= lo && at[i] <= hi) pts.push(xy[i]);
    if (i > 0 && before < hi && at[i] > hi) {
      pts.push(lerp(xy[i - 1], xy[i], (hi - before) / step));
      break;
    }
  }
  return pts;
}

/**
 * Every drawable stretch of a track between distances `a` and `b` along the whole track.
 * @param {Piece[]} pieces
 * @param {number} a
 * @param {number} b
 * @returns {Point[][]}
 */
export function sliceTrack(pieces, a, b) {
  const out = [];
  for (const piece of pieces) {
    const len = piece.at[piece.at.length - 1] || 0;
    if (b <= piece.off || a >= piece.off + len) continue;
    const pts = slicePiece(piece, Math.max(a - piece.off, 0), Math.min(b - piece.off, len));
    if (pts.length > 1) out.push(pts);
  }
  return out;
}

/**
 * Cosine ease in and out, clamped to 0–1.
 * @param {number} x
 */
export const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

/**
 * Where the chronological playback is at progress `u`: the year of the activity being
 * drawn and the coverage reached so far, interpolated within that year by activity count.
 * @param {string[]} dates Activity dates, sorted.
 * @param {Record<string, number>} years Year-end coverage, in percent.
 * @param {number} u Progress through the activities, 0–1.
 * @returns {{ year: string, pct: number }}
 */
export function inOrderAt(dates, years, u) {
  const i = Math.min(Math.max(Math.floor(u * dates.length), 0), dates.length - 1);
  const year = dates[i].slice(0, 4);
  let first = i;
  while (first > 0 && dates[first - 1].startsWith(year)) first--;
  let last = i;
  while (last < dates.length - 1 && dates[last + 1].startsWith(year)) last++;
  const earlier = Object.keys(years)
    .filter(y => y < year)
    .sort();
  const prev = earlier.length ? years[earlier[earlier.length - 1]] : 0;
  const share = (i - first + 1) / (last - first + 1);
  return { year, pct: prev + ((years[year] ?? prev) - prev) * share };
}
