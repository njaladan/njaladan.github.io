// Pure motion curves for the globe's idle spin. Each curve maps elapsed
// seconds to westward degrees turned, so easing is curve(t * T) / curve(T).
import { clamp } from '../../lib/math.js';
import { longitudeDelta } from './math.js';

/** Idle drift, in degrees per second. */
export const IDLE_SPEED = 12;
// The page-load turn starts at this speed and settles into the drift.
const BURST_SPEED = 90;
const BURST_SETTLE = 0.8;
// A throw's speed decays to the drift with this time constant, in seconds.
const FLING_SETTLE = 1.2;
const MAX_FLING_SPEED = 400;
// Drag samples older than this are dropped; a release this long after the
// last one is a pause, not a throw.
const SAMPLE_WINDOW_MS = 120;
const RELEASE_WINDOW_MS = 250;

/** Seconds a throw coasts before handing over to the drift. */
export const FLING_SECONDS = 4 * FLING_SETTLE;

/**
 * The page-load turn: a quick start that settles into the idle drift.
 * @param {number} t seconds
 * @returns {number} degrees
 */
export const introTravel = t =>
  IDLE_SPEED * t + (BURST_SPEED - IDLE_SPEED) * BURST_SETTLE * (1 - Math.exp(-t / BURST_SETTLE));

/**
 * Easing back into the drift from rest.
 * @param {number} t seconds
 * @returns {number} degrees
 */
export const idleRise = t => IDLE_SPEED * (t - (1 - Math.exp(-t)));

/**
 * A throw released at `speed` degrees per second, easing to the drift in the
 * direction it was thrown.
 * @param {number} speed
 * @param {number} t seconds
 * @returns {number} degrees
 */
export function flingTravel(speed, t) {
  const floor = Math.sign(speed) * IDLE_SPEED;
  return floor * t + (speed - floor) * FLING_SETTLE * (1 - Math.exp(-t / FLING_SETTLE));
}

/**
 * Adds a drag sample, unwrapping longitude so it stays continuous across the
 * dateline, and drops samples that fell out of the window. The newest stays.
 * @param {import('./math.js').Sample[]} samples
 * @param {number} now
 * @param {number} lng
 * @returns {import('./math.js').Sample[]}
 */
export function addSample(samples, now, lng) {
  const last = samples[samples.length - 1];
  const next = [...samples, { now, lng: last ? last.lng + longitudeDelta(lng, last.lng) : lng }];
  const newest = next[next.length - 1];
  return next.filter(sample => now - sample.now < SAMPLE_WINDOW_MS || sample === newest);
}

/**
 * The westward speed of a drag released at `now`, in degrees per second, or
 * null when the release was a stop rather than a throw.
 * @param {import('./math.js').Sample[]} samples
 * @param {number} now
 * @returns {number | null}
 */
export function releaseSpeed(samples, now) {
  const first = samples[0],
    last = samples[samples.length - 1];
  if (!first || first === last || now - last.now >= RELEASE_WINDOW_MS) return null;
  return clamp(
    -(last.lng - first.lng) / ((last.now - first.now) / 1000),
    -MAX_FLING_SPEED,
    MAX_FLING_SPEED
  );
}

/**
 * @typedef {{ start: number, end: number, easing: (t: number) => number }} Piece
 */

/**
 * Splits a monotonic ease into `pieces` legs that each cover an equal share
 * of the travel, so no single camera ease spans more than its share. Each leg
 * runs from `start` to `end` of the original time and eases its own share.
 * @param {(t: number) => number} easing
 * @param {number} pieces
 * @returns {Piece[]}
 */
export function splitEase(easing, pieces) {
  const timeAt = (/** @type {number} */ share) => {
    let low = 0,
      high = 1;
    for (let step = 0; step < 40; step++) {
      const mid = (low + high) / 2;
      if (easing(mid) < share) low = mid;
      else high = mid;
    }
    return high;
  };
  const bounds = [0, ...Array.from({ length: pieces - 1 }, (_, i) => timeAt((i + 1) / pieces)), 1];
  return bounds.slice(1).map((end, i) => {
    const start = bounds[i];
    return { start, end, easing: t => easing(start + t * (end - start)) * pieces - i };
  });
}
