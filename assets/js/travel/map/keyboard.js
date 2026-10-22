// Map layers drawn as SVG paths or markers become keyboard buttons here.

/**
 * Gives a map element a button role and label, and runs `activate` on Enter or Space.
 * @param {HTMLElement | SVGElement} node
 * @param {string} label
 * @param {() => void} activate
 * @param {{ focusable?: boolean }} [options] Markers that Leaflet already makes
 *   focusable pass `focusable: false`.
 */
export function asButton(node, label, activate, { focusable = true } = {}) {
  node.setAttribute('role', 'button');
  if (focusable) node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', label);
  node.addEventListener('keydown', event => {
    const { key } = /** @type {KeyboardEvent} */ (event);
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      activate();
    }
  });
}
