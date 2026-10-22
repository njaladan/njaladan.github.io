// Placement of the medium photo viewer over the map. Side-effect free.

// Distance kept from the window edges (px).
const EDGE = 12;
// Room left above the viewer for the map toolbar (px).
const TOOLBAR_HEIGHT = 72;
const MIN_WIDTH = 280;
const MAX_WIDTH = 400;
// The photo takes at most this share of the available height.
const PHOTO_HEIGHT_SHARE = 0.66;
// Stage padding around the photo, vertically and horizontally (px).
const STAGE_PADDING = 16;
const STAGE_INSET = 18;
// The viewer's bottom sits this far below its anchor's top (px).
const ANCHOR_OVERLAP = 48;

/**
 * @typedef {{left: number, top: number, width: number, height: number}} Box
 * @typedef {{width: number, height: number}} Viewport window inner size
 */

/**
 * The vertical band the viewer may use and its width for a photo's ratio.
 * @param {{top: number, bottom: number}} mapBox
 * @param {Viewport} viewport
 * @param {number} ratio photo width / height
 */
export function mediumFrameSize(mapBox, viewport, ratio) {
  const top = Math.max(EDGE, mapBox.top + TOOLBAR_HEIGHT),
    bottom = Math.min(viewport.height - EDGE, mapBox.bottom);
  const maxHeight = Math.max(1, bottom - top - EDGE);
  const width = Math.max(
    1,
    Math.min(
      viewport.width - 2 * EDGE,
      Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, maxHeight * PHOTO_HEIGHT_SHARE * ratio))
    )
  );
  return { top, bottom, maxHeight, width };
}

/**
 * Places the medium viewer just above its anchor (the photo's print), or the
 * map's centre, kept inside the window and the map's band.
 * @param {{mapBox: Box & {bottom: number}, viewport: Viewport, ratio: number, chromeHeight: number,
 *   anchor: Box | null}} layout
 * @returns {Box}
 */
export function mediumFrame({ mapBox, viewport, ratio, chromeHeight, anchor }) {
  const band = mediumFrameSize(mapBox, viewport, ratio);
  const { width } = band;
  const height = Math.min(
    band.maxHeight,
    chromeHeight + STAGE_PADDING + (width - STAGE_INSET) / ratio
  );
  const left = Math.max(
    EDGE,
    Math.min(
      viewport.width - width - EDGE,
      (anchor?.left || viewport.width / 2) + (anchor?.width || 0) / 2 - width / 2
    )
  );
  const top = Math.max(
    band.top,
    Math.min(
      band.bottom - height - EDGE,
      (anchor?.top || mapBox.top + mapBox.height / 2) + ANCHOR_OVERLAP - height
    )
  );
  return { left, top, width, height };
}

/**
 * Whether a box is non-empty and at least partly inside the window.
 * @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} box
 * @param {Viewport} viewport
 */
export const onScreen = (box, viewport) =>
  Boolean(box.width) &&
  Boolean(box.height) &&
  box.bottom >= 0 &&
  box.top <= viewport.height &&
  box.right >= 0 &&
  box.left <= viewport.width;
