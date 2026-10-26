import {
  VISIBLE_PRINTS,
  clamp01,
  mix,
  printCurves,
  printSlot,
  printTiming
} from './print-motion.js';

// Photo prints: the thumbnails stacked in each pin, and their animated moves
// between pins as the map regroups them.

const THUMBNAIL_SIZE = 40;
const BROKEN_THUMBNAIL = '▧';
const PRINT_POSITION_CLASSES = [
  'photo-pin-front',
  'photo-pin-back',
  'photo-pin-back-1',
  'photo-pin-back-2'
];

/**
 * @typedef {import('./records.js').Photo} Photo
 * @typedef {{marker: any, content: HTMLElement, items: Photo[], interacted: boolean}} Pin
 * @typedef {{anchor: any, offset: any, angle: number, scale: number, depth: number,
 *   moving: boolean}} PrintPose
 * @typedef {{photo: Photo, node: HTMLElement, pin: Pin | null, index: number,
 *   from?: PrintPose, started?: number, delay?: number, duration?: number,
 *   travelDepth?: number, visualAnchor?: any, visualOffset?: any, visualWorld?: any,
 *   angle?: number, scale?: number}} Print
 * @typedef {ReturnType<typeof createPrintStage>} PrintStage
 */

/**
 * All prints and the ones currently moving.
 * @param {{L: any, projection: import('./projection.js').Projection,
 *   depths: Map<string, number>, asset: (src: string) => string,
 *   requestFrame: () => void}} options
 */
export function createPrintStage(options) {
  return {
    ...options,
    /** @type {Map<string, Print>} */
    prints: new Map(),
    /** @type {Set<Print>} */
    motions: new Set(),
    /** Thumbnail URLs already shown once, which need no fade-in. */
    loaded: new Set()
  };
}

/**
 * A print's thumbnail; only newly loaded images fade in.
 * @param {PrintStage} stage
 * @param {Photo} photo
 */
function thumbnailNode(stage, photo) {
  const node = document.createElement('span');
  node.className = 'photo-pin-print';
  node.dataset.photoId = photo.id;
  const wrapper = document.createElement('span');
  wrapper.className = 'photo-pin-image';
  const thumbnail = document.createElement('img');
  thumbnail.alt = '';
  thumbnail.width = THUMBNAIL_SIZE;
  thumbnail.height = THUMBNAIL_SIZE;
  thumbnail.decoding = 'async';
  const src = stage.asset(photo.variants.thumbnail.src);
  const ready = () => thumbnail.complete && thumbnail.naturalWidth;
  if (!stage.loaded.has(src)) thumbnail.classList.add('photo-thumbnail-loading');
  thumbnail.addEventListener(
    'load',
    () => {
      stage.loaded.add(src);
      // Cached, decoded thumbnails arrive immediately; only new arrivals fade.
      if (ready() && !thumbnail.classList.contains('photo-thumbnail-loading')) return;
      thumbnail.classList.remove('photo-thumbnail-loading');
    },
    { once: true }
  );
  thumbnail.addEventListener(
    'error',
    () => {
      const fallback = document.createElement('span');
      fallback.textContent = BROKEN_THUMBNAIL;
      thumbnail.replaceWith(fallback);
      wrapper.classList.add('photo-pin-fallback');
    },
    { once: true }
  );
  thumbnail.src = src;
  if (ready()) {
    stage.loaded.add(src);
    thumbnail.classList.remove('photo-thumbnail-loading');
  }
  wrapper.append(thumbnail);
  node.append(wrapper);
  return node;
}

/**
 * Creates and registers a print for a photo not yet on the map.
 * @param {PrintStage} stage
 * @param {Photo} photo
 * @param {number} index
 * @returns {Print}
 */
export function createPrint(stage, photo, index) {
  const print = { photo, node: thumbnailNode(stage, photo), pin: null, index };
  stage.prints.set(photo.id, print);
  print.node.style.setProperty('--photo-depth', String(stage.depths.get(photo.id)));
  return print;
}

/** @param {PrintStage} stage @param {Print} print */
export function removePrint(stage, print) {
  stage.motions.delete(print);
  stage.prints.delete(print.photo.id);
  print.node.remove();
}

/**
 * Resting pose of the print at `index` in a pin.
 * @param {PrintStage} stage
 * @param {Pin} pin
 * @param {number} index
 * @returns {PrintPose}
 */
export function restingState(stage, pin, index) {
  const offset = printSlot(index);
  return {
    anchor: pin.marker.getLatLng(),
    offset: stage.L.point(offset.x, offset.y),
    angle: offset.angle,
    scale: 1,
    depth: stage.depths.get(pin.items[index].id),
    moving: false
  };
}

/**
 * The pose a print shows now, as the starting point of its next move.
 * @param {PrintStage} stage
 * @param {Print} print
 * @returns {PrintPose}
 */
export function snapshotPrint(stage, print) {
  if (stage.motions.has(print)) {
    // Travelling cards are fully controlled here; reuse their current pose
    // without asking the browser to resolve layout or computed transforms.
    const drift = print.visualWorld.subtract(stage.projection.layerPoint(print.visualAnchor));
    return {
      anchor: print.visualAnchor,
      offset: print.visualOffset.add(drift),
      angle: print.angle,
      scale: print.scale,
      depth: print.travelDepth,
      moving: true
    };
  }
  if (!print.pin.interacted && !print.pin.marker.getElement().matches(':hover,:focus-visible')) {
    return restingState(stage, print.pin, print.index);
  }
  // Hovered or focused stacks fan out in CSS. Keep paper offsets in pixels,
  // separate from geographic movement: zooming must not enlarge the spacing or
  // tilt of a stack before it releases. Its center follows the transform's
  // translation; no layout measurement is needed.
  const style = getComputedStyle(print.node);
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
  const paperScale = Number(style.scale) || 1;
  return {
    anchor: print.pin.marker.getLatLng(),
    offset: stage.L.point(matrix.e * paperScale, matrix.f * paperScale),
    angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    scale: Math.hypot(matrix.a, matrix.b) * paperScale,
    depth: Number(style.zIndex),
    moving: false
  };
}

/** @param {PrintStage} stage @param {Print} print */
function settlePrint(stage, print) {
  stage.motions.delete(print);
  print.node.classList.remove('photo-print-travelling');
  print.node.style.removeProperty('--photo-travel-depth');
  print.node.style.removeProperty('transform');
}

/**
 * Draws a moving print at `time`, settling it when its move ends.
 * @param {PrintStage} stage
 * @param {Print} print
 * @param {number} time
 */
export function paintPrint(stage, print, time) {
  const { L, projection } = stage;
  const t = clamp01((time - print.started - print.delay) / print.duration);
  const { release, travel, pop } = printCurves(t, print.from.moving);
  const anchor = projection.layerPoint(print.pin.marker.getLatLng()),
    offset = printSlot(print.index);
  const source = projection.layerPoint(print.from.anchor);
  const world = L.point(mix(source.x, anchor.x, travel), mix(source.y, anchor.y, travel));
  print.visualOffset = L.point(
    mix(print.from.offset.x, offset.x, travel),
    mix(print.from.offset.y, offset.y, travel)
  );
  print.visualWorld = world;
  const point = world.add(print.visualOffset);
  print.scale = mix(print.from.scale, 1, release) + pop;
  print.angle = mix(print.from.angle, offset.angle, travel);
  print.visualAnchor = projection.layerLatLng(world);
  print.node.style.transform = `translate3d(${point.x - anchor.x}px, ${point.y - anchor.y}px, 0) rotate(${print.angle}deg) scale(${print.scale})`;
  if (t < 1) return;
  settlePrint(stage, print);
  if (print.index >= VISIBLE_PRINTS) removePrint(stage, print);
}

/**
 * Starts moving a print from `source` into its slot in its pin. Every print
 * follows its own identity into its final slot, with no icon swap.
 * @param {PrintStage} stage
 * @param {Print} print
 * @param {{source: PrintPose, merging: boolean, time: number}} move
 */
export function animatePrint(stage, print, { source, merging, time }) {
  print.from = source;
  print.started = time;
  Object.assign(print, printTiming({ index: print.index, merging, moving: source.moving }));
  print.travelDepth = merging ? stage.depths.get(print.photo.id) : source.depth;
  print.node.style.setProperty('--photo-travel-depth', String(print.travelDepth));
  print.node.classList.add('photo-print-travelling');
  stage.motions.add(print);
  paintPrint(stage, print, time);
  stage.requestFrame();
}

/**
 * Moves a print into slot `index` of `pin`, animating from `source` if given.
 * @param {PrintStage} stage
 * @param {Print} print
 * @param {{pin: Pin, index: number, source: PrintPose | null, merging: boolean,
 *   time: number}} placement
 */
export function placePrint(stage, print, { pin, index, source, merging, time }) {
  print.pin = pin;
  print.index = index;
  print.node.classList.remove(...PRINT_POSITION_CLASSES);
  print.node.classList.add(index === 0 ? 'photo-pin-front' : 'photo-pin-back');
  if (index > 0) print.node.classList.add(index === 1 ? 'photo-pin-back-1' : 'photo-pin-back-2');
  pin.content.append(print.node);
  if (source) animatePrint(stage, print, { source, merging, time });
  else settlePrint(stage, print);
}

/**
 * Marks pins whose prints are moving, and whose front print is assembling.
 * @param {PrintStage} stage
 * @param {Iterable<Pin>} pins
 */
export function settlePins(stage, pins) {
  for (const pin of pins) {
    const node = pin.marker.getElement();
    node.classList.toggle(
      'photo-pin-moving',
      [...stage.motions].some(print => print.pin === pin)
    );
    const front = stage.prints.get(pin.items[0].id);
    node.classList.toggle('photo-pin-assembling', Boolean(front && stage.motions.has(front)));
  }
}
