// Shelf covers: spine colours, the pointer tilt, and fallbacks for failed artwork.
import { $$ } from '../lib/dom.js';

// Share of the cover's width, from the left edge, sampled for the spine colour.
const SPINE_SAMPLE = 0.04;
// Maximum tilt, in degrees, when the pointer is at a cover's edge.
const TILT_Y_DEG = 36;
const TILT_X_DEG = 24;

/** @returns {boolean} */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A book's spine takes the colour of its cover's left edge.
 * @param {HTMLElement} cover
 */
export function spineColor(cover) {
  const img = cover.querySelector('img');
  if (cover.style.getPropertyValue('--spine') || !img || img.hidden || !img.naturalWidth) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const sample = Math.max(1, img.naturalWidth * SPINE_SAMPLE);
    context.drawImage(img, 0, 0, sample, img.naturalHeight, 0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    cover.style.setProperty('--spine', `rgb(${r} ${g} ${b})`);
  } catch {
    // A cross-origin cover taints the canvas; the stylesheet's default spine stays.
  }
}

/** @param {HTMLElement} cover */
export function untilt(cover) {
  cover.classList.remove('tilting');
  ['--rx', '--ry', '--px', '--py'].forEach(name => cover.style.removeProperty(name));
}

/**
 * Pointer position over `bounds`, from -0.5 to 0.5 on each axis.
 * @param {number} value
 * @param {number} start
 * @param {number} size
 */
const offset = (value, start, size) => Math.min(Math.max((value - start) / size, 0), 1) - 0.5;

/** @param {PointerEvent} event */
function tiltToward(event) {
  if (event.pointerType !== 'mouse') return;
  const target = /** @type {Element} */ (event.target);
  const cover = target.closest('.card-link')?.querySelector('.cover');
  if (!(cover instanceof HTMLElement)) return;
  if (!cover.classList.contains('tilting')) {
    if (cover.classList.contains('book-cover')) spineColor(cover);
    requestAnimationFrame(() => cover.classList.add('tilting'));
  }
  const bounds = cover.getBoundingClientRect();
  const x = offset(event.clientX, bounds.left, bounds.width);
  const y = offset(event.clientY, bounds.top, bounds.height);
  cover.style.setProperty('--ry', `${(x * TILT_Y_DEG).toFixed(1)}deg`);
  cover.style.setProperty('--rx', `${(-y * TILT_X_DEG).toFixed(1)}deg`);
  cover.style.setProperty('--px', x.toFixed(3));
  cover.style.setProperty('--py', y.toFixed(3));
}

/**
 * Covers turn to face the pointer while the light stays put: the glare, shadow and edge
 * shading move against the turn.
 * @param {HTMLElement} root
 */
export function installCoverTilt(root) {
  if (reducedMotion()) return;
  root.addEventListener('pointermove', tiltToward);
  root.addEventListener('pointerout', event => {
    const link = /** @type {Element} */ (event.target).closest('.card-link');
    if (!link || link.contains(/** @type {Node} */ (event.relatedTarget))) return;
    untilt(link.querySelector('.cover'));
  });
}

/**
 * A failed artwork request still leaves a readable, locally styled title cover.
 * @param {HTMLElement} root
 */
export function installCoverFallbacks(root) {
  $$('.cover img', root).forEach(element => {
    const img = /** @type {HTMLImageElement} */ (element);
    const failed = () => {
      img.hidden = true;
    };
    img.addEventListener('error', failed);
    if (img.complete && !img.naturalWidth) failed();
  });
}
