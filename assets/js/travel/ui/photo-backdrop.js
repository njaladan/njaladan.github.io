import { VIEWER_ANIMATION } from './photo-frame-motion.js';

/**
 * Fades the fullscreen viewer's backdrop, hiding it once transparent.
 * @param {HTMLElement} backdrop
 * @param {boolean} reduceMotion
 * @returns {(visible: boolean, immediate?: boolean) => void}
 */
export function createBackdropFade(backdrop, reduceMotion) {
  /** @type {Animation | null} */
  let motion = null;
  return (visible, immediate = false) => {
    const from = backdrop.hidden ? 0 : Number(getComputedStyle(backdrop).opacity);
    const to = visible ? 1 : 0;
    motion?.cancel();
    motion = null;
    backdrop.style.opacity = String(to);
    if (reduceMotion || immediate || from === to) {
      backdrop.hidden = !visible;
      return;
    }
    backdrop.hidden = false;
    const animation = backdrop.animate([{ opacity: from }, { opacity: to }], VIEWER_ANIMATION);
    motion = animation;
    animation.finished.then(
      () => {
        if (motion !== animation) return;
        motion = null;
        backdrop.hidden = !visible;
      },
      // Cancelled by a newer fade, which sets the final state.
      () => {}
    );
  };
}
