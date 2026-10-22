import { $ } from '../../lib/dom.js';
import { installPhotoZoom } from './zoom.js';
import { createBackdropFade } from './backdrop.js';
import { createFrameMotion } from './frame-motion.js';
import { createViewerImage } from './image.js';
import { photoLabel } from './records.js';
import { mediumFrame, mediumFrameSize, onScreen } from './viewer-geometry.js';

// The photo viewer grows out of a pin's front print into a medium window over
// the map, can expand to a modal fullscreen view with zoom, and shrinks back
// into the print when closed. States: 'closed', 'medium' and 'full'.

// Wait for a zoom gesture to rest before loading a sharper variant (ms).
const ZOOM_SETTLE_MS = 150;
// Top and bottom borders of the medium window (px).
const FRAME_BORDERS = 2;
// Size of the frame when it closes towards a print that is off screen (px).
const COLLAPSED_SIZE = 48;
// Corner radius of a print when its computed style has none (px).
const PRINT_RADIUS = 7;
const NO_SCROLL = { preventScroll: true };

/**
 * @typedef {import('./records.js').Photo} Photo
 * @typedef {import('./prints.js').Pin} Pin
 * @typedef {import('./frame-motion.js').FrameBox} FrameBox
 * @typedef {'closed' | 'medium' | 'full'} ViewerState
 * @typedef {object} ViewerPins
 * @property {(photo: Photo | undefined) => Pin | undefined} find the pin holding a photo
 * @property {() => void} sync marks the pin of the shown photo
 * @property {(photo: Photo) => HTMLImageElement | null | undefined} thumbnail
 * @typedef {ReturnType<typeof createViewerContext>} Viewer
 */

/** Viewer elements, or null when the page has no photo viewer. */
export function findViewerElements() {
  const dialog = /** @type {HTMLDialogElement | null} */ ($('#photo-viewer'));
  const backdrop = $('#photo-backdrop');
  if (!dialog || !backdrop) return null;
  return {
    dialog,
    backdrop,
    image: /** @type {HTMLImageElement} */ ($('img', dialog)),
    title: $('#photo-title', dialog),
    caption: $('.photo-caption', dialog),
    counter: $('.photo-counter', dialog),
    previous: $('.photo-previous', dialog),
    next: $('.photo-next', dialog),
    status: $('.photo-image-status', dialog),
    stage: $('.photo-stage', dialog),
    expand: $('.photo-expand', dialog),
    shrink: $('.photo-shrink', dialog),
    well: $('.photo-image', dialog),
    pixels: $('.photo-pixels', dialog),
    closeButton: $('.photo-close', dialog),
    chrome: [$('.photo-viewer-header', dialog), $('.photo-viewer-footer', dialog)]
  };
}

const viewport = () => ({ width: innerWidth, height: innerHeight });

/** @param {Viewer} v @returns {Photo | undefined} */
const current = v => v.state.selection[v.state.index];

/** @param {Viewer} v */
const canInteract = v => v.state.view === 'full' && !v.motion.active && !v.state.closing;

/** @param {Viewer} v */
function requestImage(v) {
  if (v.state.closing || v.state.view === 'closed') return;
  v.image.load(current(v));
}

/**
 * Screen box of a photo's front print, if it is on screen.
 * @param {Viewer} v
 * @param {Photo | undefined} photo
 * @returns {FrameBox | null}
 */
function photoAnchor(v, photo) {
  const node = v.pins.find(photo)?.content.querySelector('.photo-pin-front');
  if (!node) return null;
  const box = node.getBoundingClientRect();
  if (!onScreen(box, viewport())) return null;
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    radius: parseFloat(getComputedStyle(node).borderRadius) || PRINT_RADIUS
  };
}

/** @param {HTMLElement} dialog @returns {FrameBox} */
function frameRect(dialog) {
  const box = dialog.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    radius: parseFloat(getComputedStyle(dialog).borderRadius) || 0
  };
}

/**
 * The frame for a state: the window when full, else a window near the print.
 * @param {Viewer} v
 * @param {ViewerState} state
 * @returns {FrameBox}
 */
function targetFrame(v, state) {
  if (state === 'full') return { left: 0, top: 0, ...viewport() };
  const mapBox = v.map.getContainer().getBoundingClientRect();
  const photo = current(v);
  const ratio = photo.width / photo.height;
  v.dialog.style.width = `${mediumFrameSize(mapBox, viewport(), ratio).width}px`;
  // Measure wrapping text at its destination width before sizing the frame.
  const chromeHeight =
    v.chrome.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0) + FRAME_BORDERS;
  const anchor = photoAnchor(v, photo) || v.state.openingAnchor;
  return mediumFrame({ mapBox, viewport: viewport(), ratio, chromeHeight, anchor });
}

/** Ends any close in progress and its map tracking. @param {Viewer} v */
function cancelClosing(v) {
  v.motion.stop();
  v.state.closing = false;
  v.state.closingAnchor = null;
  v.dialog.style.removeProperty('translate');
  v.dialog.classList.remove('photo-collapsing');
}

/**
 * Applies a state's modality and control labels.
 * @param {Viewer} v
 * @param {ViewerState} view
 */
function applyState(v, view) {
  const modal = view === 'full';
  v.state.view = view;
  v.dialog.dataset.state = view;
  v.dialog.setAttribute('aria-modal', String(modal));
  v.zoom.setActive(modal);
  v.expand.hidden = modal;
  v.shrink.hidden = !modal;
  v.stage.setAttribute('aria-label', modal ? 'Photo' : 'Expand photo');
  v.stage.setAttribute('role', modal ? 'group' : 'button');
  if (modal) v.stage.setAttribute('aria-describedby', 'photo-zoom-help');
  else v.stage.removeAttribute('aria-describedby');
  document.body.classList.toggle('photo-fullscreen', modal);
}

/** @param {Viewer} v */
const presentFrom = v => (v.dialog.open ? frameRect(v.dialog) : v.state.openingAnchor);

/**
 * Shows the viewer in a state, animating from `from` (the current frame, or
 * the opening print when closed).
 * @param {Viewer} v
 * @param {ViewerState} view
 * @param {{from?: FrameBox | null, focusControl?: boolean}} [options]
 */
function present(v, view, { from = presentFrom(v), focusControl = true } = {}) {
  const { dialog } = v;
  cancelClosing(v);
  v.image.commit();
  const activeControl = /** @type {HTMLElement | null} */ (
    dialog.contains(document.activeElement) ? document.activeElement : null
  );
  const modal = view === 'full';
  // Only showModal() puts the dialog in the top layer, so switching reopens it.
  if (dialog.open && dialog.matches(':modal') !== modal) dialog.close();
  applyState(v, view);
  if (!dialog.open) {
    if (modal) dialog.showModal();
    else dialog.show();
  }
  v.fadeBackdrop(modal);
  v.pins.sync();
  v.motion.move(from, targetFrame(v, view), { photo: current(v) });
  if (focusControl) (modal ? v.stage : v.expand).focus(NO_SCROLL);
  else if (activeControl && !activeControl.hidden) activeControl.focus(NO_SCROLL);
}

/**
 * Steps through the selection, updating text and image.
 * @param {Viewer} v
 * @param {number} [delta]
 * @param {boolean} [resize] refit the open frame to the new photo
 */
function changeImage(v, delta = 0, resize = true) {
  const { state } = v;
  const count = state.selection.length;
  if (!count) return;
  const from = v.dialog.open ? frameRect(v.dialog) : null;
  v.zoom.reset();
  state.index = (state.index + delta + count) % count;
  const photo = current(v);
  v.title.textContent = photoLabel(photo);
  v.caption.textContent = photo.caption || '';
  v.caption.hidden = !v.caption.textContent;
  v.counter.textContent = count > 1 ? `${state.index + 1} / ${count}` : '';
  v.previous.hidden = count < 2;
  v.next.hidden = count < 2;
  v.image.preview(photo, v.pins.thumbnail(photo));
  if (v.dialog.open && resize) present(v, state.view, { from, focusControl: false });
}

/**
 * Opens photos in the medium viewer, growing out of the photo's print.
 * @param {Viewer} v
 * @param {Photo[]} items
 * @param {number} [index]
 */
function openPhoto(v, items, index = 0) {
  const from = v.dialog.open ? frameRect(v.dialog) : photoAnchor(v, items[index]);
  Object.assign(v.state, { selection: items, index });
  v.state.returnFocus = v.pins.find(current(v))?.marker.getElement();
  v.state.openingAnchor = photoAnchor(v, items[index]);
  changeImage(v, 0, false);
  present(v, 'medium', { from });
}

/**
 * Closes at once and releases the image.
 * @param {Viewer} v
 * @param {boolean} [restoreFocus] return focus to the photo's pin
 */
function finishClose(v, restoreFocus = true) {
  cancelClosing(v);
  v.state.view = 'closed';
  v.dialog.dataset.state = 'closed';
  if (v.dialog.open) v.dialog.close();
  document.body.classList.remove('photo-fullscreen');
  v.fadeBackdrop(false, true);
  v.pins.sync();
  v.zoom.setActive(false);
  clearTimeout(v.state.zoomTimer);
  v.state.zoomTimer = null;
  v.image.cancel();
  v.image.clear();
  if (!restoreFocus) return;
  const { returnFocus } = v.state;
  const target =
    v.pins.find(current(v))?.marker.getElement() ||
    (returnFocus?.isConnected ? returnFocus : v.map.getContainer());
  target.focus(NO_SCROLL);
}

/**
 * Shrinks the viewer back into the photo's print, then closes.
 * @param {Viewer} v
 */
function closeViewer(v) {
  if (!v.dialog.open || v.state.closing) return;
  v.zoom.reset();
  const from = frameRect(v.dialog),
    to = photoAnchor(v, current(v));
  v.state.closing = true;
  const { coords } = current(v);
  v.state.closingAnchor = to ? { coords, point: v.containerPoint(coords) } : null;
  v.dialog.classList.add('photo-collapsing');
  v.fadeBackdrop(false);
  const collapsed = to || { ...from, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE };
  v.motion.move(from, collapsed, { photo: current(v), complete: () => finishClose(v) });
}

/** Leaves fullscreen, or closes the medium viewer. @param {Viewer} v */
function stepBack(v) {
  if (v.state.closing) return;
  if (v.state.view === 'full') present(v, 'medium');
  else closeViewer(v);
}

/** @param {Viewer} v */
function followClosingAnchor(v) {
  const anchor = v.state.closingAnchor;
  if (!anchor) return;
  // The fixed dialog must travel with the map while it shrinks back into
  // the print. Keep this offset separate from the size/position animation.
  const offset = v.containerPoint(anchor.coords).subtract(anchor.point);
  v.dialog.style.translate = `${offset.x}px ${offset.y}px`;
}

/** @param {Viewer} v */
function resizeViewer(v) {
  if (!v.dialog.open) return;
  if (v.state.closing) {
    finishClose(v);
    return;
  }
  v.motion.stop();
  v.zoom.reset();
  v.motion.move(null, targetFrame(v, v.state.view), { photo: current(v) });
}

/**
 * @param {NonNullable<ReturnType<typeof findViewerElements>>} elements
 * @param {{map: any, pins: ViewerPins, reduceMotion: boolean, asset: (src: string) => string,
 *   containerPoint: (coords: any) => any}} options
 */
function createViewerContext(elements, { map, pins, reduceMotion, asset, containerPoint }) {
  const v = {
    ...elements,
    map,
    pins,
    containerPoint,
    state: {
      /** @type {ViewerState} */
      view: 'closed',
      closing: false,
      /** @type {{coords: any, point: any} | null} */
      closingAnchor: null,
      /** @type {FrameBox | null} */
      openingAnchor: null,
      /** @type {Photo[]} */
      selection: [],
      index: 0,
      /** @type {HTMLElement | null | undefined} */
      returnFocus: null,
      /** @type {ReturnType<typeof setTimeout> | null} */
      zoomTimer: null
    },
    fadeBackdrop: createBackdropFade(elements.backdrop, reduceMotion),
    /** @type {ReturnType<typeof installPhotoZoom>} */
    zoom: null,
    /** @type {ReturnType<typeof createViewerImage>} */
    image: null,
    /** @type {ReturnType<typeof createFrameMotion>} */
    motion: null
  };
  v.zoom = installPhotoZoom(elements.well, elements.pixels, elements.image, {
    canInteract: () => canInteract(v),
    onScale: () => {
      clearTimeout(v.state.zoomTimer);
      v.state.zoomTimer = setTimeout(() => {
        v.state.zoomTimer = null;
        if (canInteract(v)) requestImage(v);
      }, ZOOM_SETTLE_MS);
    }
  });
  v.image = createViewerImage(elements, {
    asset,
    scale: () => v.zoom.scale,
    canCommit: () => !v.motion.active && !v.state.closing && v.state.view !== 'closed'
  });
  v.motion = createFrameMotion(elements, {
    reduceMotion,
    resized: () => requestImage(v),
    settled: animated => {
      if (animated) v.zoom.invalidate();
      v.image.commit();
    }
  });
  return v;
}

/**
 * Viewer controls, keyboard, outside presses and map movement.
 * @param {Viewer} v
 * @param {AbortSignal} signal
 */
function bindViewerEvents(v, signal) {
  const { dialog, stage } = v;
  const options = { signal };
  window.addEventListener('resize', () => resizeViewer(v), options);
  document.addEventListener(
    'pointerdown',
    event => {
      const target = /** @type {Element} */ (event.target);
      if (!dialog.open || v.state.view !== 'medium') return;
      if (dialog.contains(target) || target.closest('.photo-pin')) return;
      closeViewer(v);
    },
    options
  );
  document.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stepBack(v);
    },
    { capture: true, signal }
  );
  v.previous.addEventListener('click', () => changeImage(v, -1), options);
  v.next.addEventListener('click', () => changeImage(v, 1), options);
  v.expand.addEventListener('click', () => present(v, 'full'), options);
  stage.addEventListener(
    'click',
    () => {
      if (v.state.view !== 'full') present(v, 'full');
    },
    options
  );
  stage.addEventListener(
    'keydown',
    event => {
      if (v.state.view === 'medium' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        present(v, 'full');
      }
    },
    options
  );
  v.shrink.addEventListener('click', () => stepBack(v), options);
  v.closeButton.addEventListener('click', () => closeViewer(v), options);
  bindDialogEvents(v, signal);
}

/**
 * @param {Viewer} v
 * @param {AbortSignal} signal
 */
function bindDialogEvents(v, signal) {
  const { dialog } = v;
  dialog.addEventListener(
    'click',
    event => {
      if (event.target === dialog && v.state.view === 'full') stepBack(v);
    },
    { signal }
  );
  dialog.addEventListener(
    'cancel',
    event => {
      event.preventDefault();
      stepBack(v);
    },
    { signal }
  );
  dialog.addEventListener(
    'keydown',
    event => {
      if (!v.state.closing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        changeImage(v, event.key === 'ArrowLeft' ? -1 : 1);
      }
      event.stopPropagation();
    },
    { signal }
  );
  // Changing between modal and nonmodal presentation queues a close event.
  dialog.addEventListener(
    'close',
    () => {
      if (!dialog.open && v.state.view !== 'closed') finishClose(v);
    },
    { signal }
  );
  v.map.on('dragstart', () => {
    if (v.state.view === 'medium') closeViewer(v);
  });
  v.map.on('move', () => followClosingAnchor(v));
  v.map.on('popupopen', () => {
    if (dialog.open && v.state.view !== 'full') finishClose(v, false);
  });
}

/**
 * Installs the photo viewer.
 * @param {NonNullable<ReturnType<typeof findViewerElements>>} elements
 * @param {Parameters<typeof createViewerContext>[1]} options
 */
export function createPhotoViewer(elements, options) {
  const v = createViewerContext(elements, options);
  const listeners = new AbortController();
  bindViewerEvents(v, listeners.signal);
  return {
    /** @param {Photo[]} items @param {number} [index] */
    open: (items, index) => openPhoto(v, items, index),
    /** Closes at once; focus returns to the pin unless `restoreFocus` is false. */
    finish: (restoreFocus = true) => finishClose(v, restoreFocus),
    isOpen: () => v.dialog.open,
    /** The photo shown, while the viewer is open. */
    shown: () => (v.state.view !== 'closed' ? current(v) : undefined),
    destroy() {
      finishClose(v, false);
      v.zoom.destroy();
      v.image.forget();
      listeners.abort();
    }
  };
}
