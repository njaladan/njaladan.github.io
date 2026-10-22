import { clamp } from '../../lib/math.js';
import { wheelUnit } from '../shared/zoom-math.js';

// Continuous camera zoom for the bundled Leaflet 1.9 map. Keep one geographic
// anchor under the pointer and interpolate the camera once per animation frame.
// Leaflet's _move hooks scale its tiles and vector renderer during the gesture;
// _moveEnd then refreshes tile levels and reprojects vector geometry once.

// Frame time assumed for the first frame of a gesture (ms).
const FIRST_FRAME_MS = 16;
// Frame time is clamped so a stalled tab doesn't jump the camera (ms).
const MAX_FRAME_MS = 64;
// Exponential approach time constant toward the target zoom (ms).
const EASE_MS = 65;
// Zoom difference treated as arrival.
const SNAP_EPSILON = 0.002;
// Quiet period after arriving before the move ends (ms).
const IDLE_MS = 100;
// Zoom levels per wheel pixel; trackpad pinches (Ctrl-wheel) are coarser.
const WHEEL_ZOOM_RATE = 0.0025;
const PINCH_ZOOM_RATE = 0.01;
const MAX_WHEEL_STEP = 1;

/**
 * Replaces Leaflet's stepped wheel zoom with a smooth, pointer-anchored zoom.
 * @param {any} map Leaflet map (or the globe renderer, which provides its own)
 * @param {boolean} reduceMotion jump straight to each target zoom
 * @returns {{finish: () => void}}
 */
export function installSmoothZoom(map, reduceMotion) {
  if (map.installSmoothZoom) return map.installSmoothZoom(reduceMotion);
  const element = map.getContainer();
  const camera = { frame: null, target: map.getZoom(), anchor: null, point: null, moving: false };
  let lastTime = 0,
    idleTimer;
  const limitZoom = zoom => clamp(zoom, map.getMinZoom(), map.getMaxZoom());
  function finish() {
    if (camera.frame !== null) cancelAnimationFrame(camera.frame);
    camera.frame = null;
    clearTimeout(idleTimer);
    if (camera.moving) {
      camera.moving = false;
      map._moveEnd(true);
    }
    camera.target = map.getZoom();
  }
  function tick(time) {
    const elapsed =
      lastTime === null ? FIRST_FRAME_MS : Math.max(1, Math.min(time - lastTime, MAX_FRAME_MS));
    lastTime = time;
    const current = map.getZoom();
    const ease = reduceMotion ? 1 : 1 - Math.exp(-elapsed / EASE_MS);
    const next = current + (camera.target - current) * ease;
    const zoom = Math.abs(camera.target - next) < SNAP_EPSILON ? camera.target : next;
    const offset = camera.point.subtract(map.getSize().divideBy(2));
    const center = map.unproject(map.project(camera.anchor, zoom).subtract(offset), zoom);
    map._move(center, zoom, { pinch: true });
    if (zoom !== camera.target) {
      camera.frame = requestAnimationFrame(tick);
    } else {
      camera.frame = null;
      idleTimer = setTimeout(finish, IDLE_MS);
    }
  }
  function zoomBy(delta, cursor = map.getSize().divideBy(2)) {
    clearTimeout(idleTimer);
    if (!camera.moving) {
      map.stop();
      camera.target = map.getZoom();
      camera.moving = true;
      map._moveStart(true, false);
    }
    camera.anchor = map.containerPointToLatLng(cursor);
    camera.point = cursor;
    camera.target = limitZoom(camera.target + delta);
    if (camera.frame === null) {
      lastTime = null;
      camera.frame = requestAnimationFrame(tick);
    }
  }
  /** @param {WheelEvent} event */
  function wheel(event) {
    // Browser pinch-to-zoom on trackpads arrives as a Ctrl-wheel event.
    const units = wheelUnit(event.deltaMode, element.clientHeight);
    const delta = -event.deltaY * units * (event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE);
    const target = /** @type {Element} */ (event.target);
    if (!delta || target.closest('.leaflet-control,.leaflet-popup')) return;
    event.preventDefault();
    zoomBy(clamp(delta, -MAX_WHEEL_STEP, MAX_WHEEL_STEP), map.mouseEventToContainerPoint(event));
  }
  const listeners = new AbortController();
  const { signal } = listeners;
  element.addEventListener('wheel', wheel, { passive: false, signal });
  element.addEventListener('pointerdown', finish, { signal });
  element.addEventListener('touchstart', finish, { passive: true, signal });
  element.addEventListener('keydown', finish, { signal });
  map.on('unload', () => {
    finish();
    listeners.abort();
  });
  return { finish };
}
