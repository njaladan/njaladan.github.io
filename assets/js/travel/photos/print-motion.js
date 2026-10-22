// Timing curves for photo prints moving between pins. Side-effect free.

// Magnetic pop at the selected 0.45× timing (ms).
export const PRINT_MOTION_MS = 240 / 0.45;
// Merging prints land slightly sooner, staggered rear first (ms).
const MERGE_SHORTEN_MS = 64;
const MERGE_STAGGER_MS = 32;
// A stack shows its first three prints; later ones exist only while travelling.
export const VISIBLE_PRINTS = 3;
// Share of the motion a resting print spends lifting before it travels.
const LIFT_SHARE = 0.17;
// Share of the motion spent in the initial press-down of the pop.
const PRESS_SHARE = 0.34;
const PRESS_DEPTH = 0.1;
const OVERSHOOT = 0.035;

/** @param {number} value */
export const clamp01 = value => Math.max(0, Math.min(1, value));

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
export const mix = (a, b, t) => a + (b - a) * t;

/**
 * Resting offset (px) and tilt (deg) of the print at `index` in a stack.
 * @param {number} index
 * @returns {{x: number, y: number, angle: number}}
 */
export function printSlot(index) {
  if (index === 0) return { x: 0, y: 0, angle: 0 };
  if (index === 1) return { x: 5, y: -4, angle: 9 };
  return { x: -5, y: -7, angle: -10 };
}

/**
 * Start delay and duration of a print's move; rear prints arrive first and
 * the front print lands last.
 * @param {{index: number, merging: boolean, moving: boolean}} print
 * @returns {{delay: number, duration: number}}
 */
export function printTiming({ index, merging, moving }) {
  return {
    delay: merging && !moving ? Math.max(0, 2 - index) * MERGE_STAGGER_MS : 0,
    duration: merging ? PRINT_MOTION_MS - MERGE_SHORTEN_MS : PRINT_MOTION_MS
  };
}

/**
 * Pose curves at linear progress `t`: `travel` eases position and angle with
 * a slight overshoot, `release` blends scale, `pop` adds a press-and-bounce.
 * Prints already moving skip the lift and the pop.
 * @param {number} t 0..1
 * @param {boolean} moving
 */
export function printCurves(t, moving) {
  const release = moving ? t : clamp01((t - LIFT_SHARE) / (1 - LIFT_SHARE));
  const travel = release === 0 ? 0 : 1 + 2.15 * (release - 1) ** 3 + 1.15 * (release - 1) ** 2;
  let pop = 0;
  if (!moving) {
    pop =
      t <= PRESS_SHARE
        ? -PRESS_DEPTH * Math.sin(Math.PI * clamp01(t / PRESS_SHARE))
        : OVERSHOOT * Math.sin(Math.PI * release);
  }
  return { release, travel, pop };
}
