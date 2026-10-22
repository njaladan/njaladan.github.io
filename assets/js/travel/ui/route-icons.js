// 16px glyphs for travel modes. Keys only select fixed markup, so icon()
// never interpolates its input; unknown modes fall back to the car.
const ICONS = {
  hiking: '<path d="M1.5 13 6 5.5l2.6 4L10.6 7l3.9 6z" fill="currentColor"/>',
  walking:
    '<ellipse cx="5.6" cy="5.4" rx="1.7" ry="2.6" fill="currentColor"/><ellipse cx="10.4" cy="10.4" rx="1.7" ry="2.6" fill="currentColor"/>',
  running:
    '<path d="m4 3.5 5 4.5-5 4.5M8.5 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  cycling:
    '<circle cx="4" cy="10.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="10.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 10.5 6.5 6h4l1.5 4.5M6.5 6 8.5 10.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  Train:
    '<rect x="4" y="2.5" width="8" height="9" rx="2" fill="currentColor"/><rect x="5.5" y="4" width="5" height="3" rx=".6" fill="var(--mode)"/><path d="m5 13.5 1.5-2M11 13.5l-1.5-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  Drive:
    '<path d="M2.5 10.5V8.3L4 5.2h8l1.5 3.1v2.2z" fill="currentColor"/><circle cx="5" cy="11" r="1.4" fill="currentColor"/><circle cx="11" cy="11" r="1.4" fill="currentColor"/><path d="M5 6.3h6l.8 1.8H4.2z" fill="var(--mode)"/>',
  Bus: '<rect x="3" y="2" width="10" height="10" rx="2" fill="currentColor"/><rect x="4.3" y="4" width="7.4" height="4" rx=".5" fill="var(--mode)"/><circle cx="5" cy="10" r=".8" fill="var(--mode)"/><circle cx="11" cy="10" r=".8" fill="var(--mode)"/><path d="M5 12v1M11 12v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  Ferry:
    '<path d="M2 9h12l-1.8 3.2H3.8z" fill="currentColor"/><path d="M5 9V6h5l1.5 3" fill="currentColor"/><path d="M1.5 14c1.2-.8 2.3-.8 3.5 0s2.3.8 3.5 0 2.3-.8 3.5 0" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  Gondola:
    '<path d="m1.5 3.5 13 2.5M8 4.8v2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="4.5" y="7.2" width="7" height="6" rx="1.4" fill="currentColor"/><rect x="5.8" y="8.4" width="4.4" height="2.2" rx=".4" fill="var(--mode)"/>',
  Flight:
    '<path d="M14 8.6 9 6.4V3a1 1 0 0 0-2 0v3.4L2 8.6v1.3l5-1.3v3l-1.5 1.1v1l2.5-.6 2.5.6v-1L9 11.6v-3l5 1.3z" fill="currentColor"/>'
};

/**
 * SVG markup for a travel mode's glyph.
 * @param {string} key activity type or transport mode
 * @returns {string}
 */
export const icon = key =>
  `<svg viewBox="0 0 16 16" aria-hidden="true">${Object.hasOwn(ICONS, key) ? ICONS[key] : ICONS.Drive}</svg>`;
