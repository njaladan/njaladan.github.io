import { $ } from '../lib/dom.js';
import {
  anchoredOffset,
  clamp,
  constrainOffset,
  containSize,
  pinch,
  wheelUnit
} from './ui/zoom-math.js';

/* Fullscreen photo gestures; paints at most once per input frame. */

const MIN_SCALE = 1;
const MAX_SCALE = 6;
// Zoom factor of one button press or +/− key.
const STEP_SCALE = 1.25;
// Largest wheel delta honoured per event (px), so one flick can't jump to max zoom.
const MAX_WHEEL_DELTA = 240;
// Scale change per wheel pixel; trackpad pinches (Ctrl-wheel) are coarser.
const WHEEL_ZOOM_RATE = 0.002;
const PINCH_ZOOM_RATE = 0.01;
// Arrow keys pan an enlarged photo by this much (px).
const KEY_PAN = 48;
const ARROW_PAN = {
  ArrowLeft: [KEY_PAN, 0],
  ArrowRight: [-KEY_PAN, 0],
  ArrowUp: [0, KEY_PAN],
  ArrowDown: [0, -KEY_PAN]
};
const ZOOM_IN_KEYS = ['+', '='];
const ZOOM_OUT_KEYS = ['-', '_'];
const RESET_KEYS = ['0', 'Home'];

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{left: number, top: number, width: number, height: number,
 *   photoWidth: number, photoHeight: number}} Bounds
 * @typedef {ReturnType<typeof createZoomView>} ZoomView
 */

/**
 * The zoomed pose of a photo and its painting.
 * @param {{viewport: HTMLElement, pixels: HTMLElement, image: HTMLImageElement,
 *   buttons: {out: HTMLButtonElement, reset: HTMLButtonElement, into: HTMLButtonElement},
 *   onScale: () => void}} parts
 */
function createZoomView({ viewport, pixels, image, buttons, onScale }) {
  /** @type {Map<number, {clientX: number, clientY: number}>} */
  const pointers = new Map();
  const pose = { scale: 1, x: 0, y: 0 };
  /** @type {Bounds | null} */
  let bounds = null;
  /** @type {number | null} */
  let paintFrame = null;
  /** Viewport and letterboxed photo sizes, cached until invalidated. */
  function measure() {
    if (!bounds) {
      const box = viewport.getBoundingClientRect();
      const ratio = Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
      const photo = containSize(box, ratio);
      bounds = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        photoWidth: photo.width,
        photoHeight: photo.height
      };
    }
    return bounds;
  }
  function paint() {
    paintFrame = null;
    const { scale, x, y } = pose;
    pixels.style.transform = scale === 1 ? '' : `translate3d(${x}px,${y}px,0) scale(${scale})`;
    viewport.classList.toggle('photo-zoomed', scale > 1);
    viewport.classList.toggle('photo-dragging', pointers.size > 0 && scale > 1);
    buttons.reset.textContent = `${Math.round(scale * 100)}%`;
    buttons.out.disabled = scale <= MIN_SCALE;
    buttons.into.disabled = scale >= MAX_SCALE;
  }
  /** Sets scale and offset, keeping the photo covering the viewport. */
  function setPose(nextScale, nextX, nextY) {
    const box = measure(),
      oldScale = pose.scale;
    pose.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    pose.x = constrainOffset(nextX, box.width, box.photoWidth, pose.scale);
    pose.y = constrainOffset(nextY, box.height, box.photoHeight, pose.scale);
    if (paintFrame === null) paintFrame = requestAnimationFrame(paint);
    if (pose.scale !== oldScale) onScale();
  }
  function reset() {
    for (const id of pointers.keys()) {
      if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    }
    pointers.clear();
    bounds = null;
    const changed = pose.scale !== 1;
    Object.assign(pose, { scale: 1, x: 0, y: 0 });
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    paint();
    if (changed) onScale();
  }
  return {
    pose,
    pointers,
    measure,
    paint,
    setPose,
    reset,
    queuePaint() {
      if (paintFrame === null) paintFrame = requestAnimationFrame(paint);
    },
    invalidate() {
      bounds = null;
    },
    /** Zooms to `scale`, keeping `point` (viewport pixels) in place. */
    zoomAt(scale, point) {
      const next = clamp(scale, MIN_SCALE, MAX_SCALE);
      const ratio = next / pose.scale;
      setPose(next, anchoredOffset(point.x, pose.x, ratio), anchoredOffset(point.y, pose.y, ratio));
    },
    /** @returns {Point} */
    center() {
      const box = measure();
      return { x: box.width / 2, y: box.height / 2 };
    },
    /** @param {{clientX: number, clientY: number}} point @returns {Point} */
    local(point) {
      const box = measure();
      return { x: point.clientX - box.left, y: point.clientY - box.top };
    }
  };
}

/**
 * Drag and pinch with pointers: each gesture starts from the pose and pointer
 * positions when a pointer was added or removed.
 * @param {HTMLElement} viewport
 * @param {ZoomView} view
 * @param {() => boolean} enabled
 */
function pointerHandlers(viewport, view, enabled) {
  const { pointers, pose } = view;
  let gesture = null;
  const positions = () => pinch([...pointers.values()].slice(0, 2).map(view.local));
  function beginGesture() {
    gesture = pointers.size ? { ...positions(), ...pose } : null;
    view.queuePaint();
  }
  /** @param {PointerEvent} event */
  function track(event) {
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  }
  return {
    /** @param {PointerEvent} event */
    down(event) {
      if (!enabled() || event.button !== 0 || (event.pointerType === 'mouse' && pose.scale === 1)) {
        return;
      }
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      track(event);
      beginGesture();
    },
    /** @param {PointerEvent} event */
    move(event) {
      if (!enabled() || !pointers.has(event.pointerId)) return;
      event.preventDefault();
      track(event);
      const current = positions();
      const scale =
        gesture.distance > 0
          ? clamp((gesture.scale * current.distance) / gesture.distance, MIN_SCALE, MAX_SCALE)
          : pose.scale;
      const ratio = scale / gesture.scale;
      view.setPose(
        scale,
        current.point.x + (gesture.x - gesture.point.x) * ratio,
        current.point.y + (gesture.y - gesture.point.y) * ratio
      );
    },
    /** @param {PointerEvent} event */
    up(event) {
      if (!pointers.delete(event.pointerId)) return;
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      beginGesture();
    },
    reset() {
      gesture = null;
    }
  };
}

/**
 * Wheel zooms around the pointer; keys zoom around the centre and pan.
 * @param {ZoomView} view
 * @param {() => boolean} enabled
 * @param {() => void} reset
 */
function keyAndWheelHandlers(view, enabled, reset) {
  const { pose } = view;
  /** @param {string} key @returns {boolean} whether the key was used */
  function applyKey(key) {
    if (ZOOM_IN_KEYS.includes(key)) view.zoomAt(pose.scale * STEP_SCALE, view.center());
    else if (ZOOM_OUT_KEYS.includes(key)) view.zoomAt(pose.scale / STEP_SCALE, view.center());
    else if (RESET_KEYS.includes(key)) reset();
    else if (pose.scale > 1 && Object.hasOwn(ARROW_PAN, key)) {
      const [dx, dy] = ARROW_PAN[key];
      view.setPose(pose.scale, pose.x + dx, pose.y + dy);
    } else return false;
    return true;
  }
  return {
    /** @param {WheelEvent} event */
    wheel(event) {
      if (!enabled()) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = wheelUnit(event.deltaMode, view.measure().height);
      const delta = clamp(event.deltaY * unit, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
      const rate = event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      view.zoomAt(pose.scale * Math.exp(-delta * rate), view.local(event));
    },
    /** @param {KeyboardEvent} event */
    keydown(event) {
      if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!applyKey(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

/**
 * Zoom and pan for the fullscreen photo: wheel, pinch, drag, keyboard and the
 * zoom buttons in `.photo-zoom-controls`.
 * @param {HTMLElement} viewport element receiving gestures
 * @param {HTMLElement} pixels element transformed to zoom
 * @param {HTMLImageElement} image photo, whose width/height attributes give its ratio
 * @param {{canInteract: () => boolean, onScale: () => void}} options
 */
export function installPhotoZoom(viewport, pixels, image, { canInteract, onScale }) {
  const controls = $('.photo-zoom-controls');
  const buttons = {
    out: /** @type {HTMLButtonElement} */ ($('.photo-zoom-out', controls)),
    reset: /** @type {HTMLButtonElement} */ ($('.photo-zoom-reset', controls)),
    into: /** @type {HTMLButtonElement} */ ($('.photo-zoom-in', controls))
  };
  let active = false;
  const enabled = () => active && canInteract();
  const view = createZoomView({ viewport, pixels, image, buttons, onScale });
  const pointer = pointerHandlers(viewport, view, enabled);
  function reset() {
    pointer.reset();
    view.reset();
  }
  const input = keyAndWheelHandlers(view, enabled, reset);
  const listeners = new AbortController();
  const options = { passive: false, signal: listeners.signal };
  viewport.addEventListener('pointerdown', pointer.down, options);
  viewport.addEventListener('pointermove', pointer.move, options);
  viewport.addEventListener('pointerup', pointer.up, options);
  viewport.addEventListener('pointercancel', pointer.up, options);
  viewport.addEventListener('lostpointercapture', pointer.up, options);
  viewport.addEventListener('wheel', input.wheel, options);
  viewport.parentElement.addEventListener('keydown', input.keydown, options);
  const whenEnabled = action => () => {
    if (enabled()) action();
  };
  buttons.out.addEventListener(
    'click',
    whenEnabled(() => view.zoomAt(view.pose.scale / STEP_SCALE, view.center())),
    options
  );
  buttons.into.addEventListener(
    'click',
    whenEnabled(() => view.zoomAt(view.pose.scale * STEP_SCALE, view.center())),
    options
  );
  buttons.reset.addEventListener('click', whenEnabled(reset), options);
  view.paint();
  return {
    get scale() {
      return view.pose.scale;
    },
    reset,
    invalidate: view.invalidate,
    /** Enables gestures and shows the zoom controls while the photo is fullscreen. */
    setActive(value) {
      if (value !== active) reset();
      active = value;
      controls.hidden = !value;
      viewport.classList.toggle('photo-zoomable', value);
    },
    destroy() {
      reset();
      listeners.abort();
    }
  };
}
