import { travelAsset } from './runtime.js';
import { DETAIL_ZOOM, clusterPhotos, photoSpacing } from './ui/photo-clusters.js';
import { createPinFactory } from './ui/photo-pins.js';
import {
  createPrint,
  createPrintStage,
  paintPrint,
  placePrint,
  removePrint,
  restingState,
  settlePins,
  snapshotPrint
} from './ui/photo-prints.js';
import { createProjection } from './ui/photo-projection.js';
import { VISIBLE_PRINTS } from './ui/print-motion.js';
import { groupKey, isAtlasPhotoPath, normalizePhotos, photoDepths } from './ui/photo-records.js';
import { createPhotoViewer, findViewerElements } from './ui/photo-viewer.js';

/* Photo assets are fetched only for visible pins or an explicitly opened image. */

const PHOTO_PANE_Z_INDEX = 460;
// While the camera moves, regroup pins at most this often (ms); pins still
// track the map every frame.
const LAYOUT_INTERVAL_MS = 120;
// Zoom used when opening a single photo from a stack that never splits.
const SINGLE_PHOTO_ZOOM = 15;
// Most zoom levels one stack selection may jump.
const MAX_SELECT_ZOOM_STEP = 3;
// Step just beyond the spacing boundary to avoid rounding back into the same
// stack at the end of the camera animation.
const SPLIT_ZOOM_MARGIN = 0.01;

/**
 * @typedef {import('./ui/photo-records.js').Photo} Photo
 * @typedef {import('./ui/photo-prints.js').Pin} Pin
 * @typedef {{pin: Pin, index: number}} Owner
 * @typedef {ReturnType<typeof createAtlas>} Atlas
 */

// Returned when the page has no photo viewer, so callers need no checks.
const INERT_PHOTOS = {
  setVisible() {},
  load() {},
  occupied: () => [],
  cancel() {},
  isOpen: () => false,
  show() {}
};

/**
 * Resolves a photo file path from data, refusing anything outside the atlas.
 * @param {unknown} src
 */
const asset = src => (isAtlasPhotoPath(src) ? travelAsset(src) : '');

/**
 * Shared state of the photo layer.
 * @param {any} map
 * @param {{focus: (target: any) => (() => void) | void, onLayout: () => void}} options
 */
function createAtlas(map, options) {
  const L = map.atlasRenderer || window.L;
  const projection = createProjection(map);
  /** @type {Map<string, number>} */
  const depths = new Map();
  const atlas = {
    map,
    L,
    options,
    projection,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    layer: L.layerGroup().addTo(map),
    /** @type {Map<string, Pin>} pins by group key */
    pins: new Map(),
    depths,
    /** @type {Photo[]} */
    photos: [],
    visible: true,
    /** @type {number | null} */
    frame: null,
    layoutPending: false,
    lastLayout: 0,
    /** @type {(() => void) | null} cancels a camera move that will open a photo */
    cancelFocus: null,
    stage: createPrintStage({ L, projection, depths, asset, requestFrame: () => {} }),
    /** @type {ReturnType<typeof createPhotoViewer>} */
    viewer: null,
    /** @type {ReturnType<typeof createPinFactory>} */
    pinFactory: null
  };
  atlas.stage.requestFrame = () => requestFrame(atlas);
  return atlas;
}

/** @param {Atlas} atlas @param {Photo | undefined} photo */
const pinOf = (atlas, photo) =>
  [...atlas.pins.values()].find(pin => pin.items.some(item => item.id === photo?.id));

/** Hides the open photo's pin behind the viewer, restoring the others. @param {Atlas} atlas */
function syncSelectedPin(atlas) {
  const shown = atlas.viewer.shown();
  const selected = shown ? pinOf(atlas, shown) : null;
  atlas.pins.forEach(pin => {
    const node = pin.marker.getElement(),
      active = pin === selected;
    if (!node) return;
    node.classList.toggle('photo-pin-selected', active);
    if (active) {
      node.setAttribute('aria-hidden', 'true');
      node.tabIndex = -1;
    } else {
      node.removeAttribute('aria-hidden');
      node.tabIndex = 0;
    }
  });
}

/** @param {Atlas} atlas */
function cancelFocus(atlas) {
  if (!atlas.cancelFocus) return;
  atlas.cancelFocus();
  atlas.cancelFocus = null;
}

/**
 * Zoom at which a stack first splits. Layout groups around the first photo,
 * rather than the stack's midpoint. Null if it never splits.
 * @param {any} map
 * @param {Photo[]} items
 */
function firstSplitZoom(map, items) {
  const maxZoom = map.getMaxZoom(),
    anchor = map.project(items[0].coords, maxZoom);
  const radius = items.reduce(
    (distance, photo) => Math.max(distance, anchor.distanceTo(map.project(photo.coords, maxZoom))),
    0
  );
  if (radius < photoSpacing(maxZoom)) return null;
  const overviewZoom = map.getScaleZoom(photoSpacing(0) / radius, maxZoom);
  const detailZoom = map.getScaleZoom(photoSpacing(DETAIL_ZOOM) / radius, maxZoom);
  // Spacing shrinks at DETAIL_ZOOM, so a stack may split on either side of it.
  return Math.min(
    maxZoom,
    Math.min(overviewZoom, Math.max(DETAIL_ZOOM, detailZoom)) + SPLIT_ZOOM_MARGIN
  );
}

/**
 * Opens a single photo, or zooms until a stack splits; a stack that never
 * splits zooms in close and then opens.
 * @param {Atlas} atlas
 * @param {Photo[]} items
 */
function select(atlas, items) {
  const { map } = atlas;
  cancelFocus(atlas);
  map.closePopup();
  if (items.length === 1) {
    atlas.viewer.open(items);
    return;
  }
  const splitZoom = firstSplitZoom(map, items);
  if (splitZoom !== null) {
    atlas.options.focus({
      bounds: atlas.L.latLngBounds(items.map(photo => photo.coords)),
      country: items.every(photo => photo.country === items[0].country) ? items[0].country : null,
      maxZoom: Math.min(map.getMaxZoom(), Math.max(map.getZoom() + MAX_SELECT_ZOOM_STEP, splitZoom))
    });
    return;
  }
  atlas.cancelFocus =
    atlas.options.focus({
      coords: items[0].coords,
      country: items[0].country,
      zoom: Math.max(SINGLE_PHOTO_ZOOM, map.getZoom()),
      complete: () => {
        atlas.cancelFocus = null;
        atlas.viewer.open(items);
      }
    }) || null;
}

/** @param {Atlas} atlas */
function requestFrame(atlas) {
  if (atlas.frame === null) atlas.frame = requestAnimationFrame(time => tick(atlas, time));
}

/** @param {Atlas} atlas @param {number} time */
function tick(atlas, time) {
  atlas.frame = null;
  // Regrouping rebuilds pins and thumbnails. While the camera is moving,
  // do it a few times a second; pins still track the map every frame.
  if (atlas.layoutPending && time - atlas.lastLayout >= LAYOUT_INTERVAL_MS) {
    atlas.layoutPending = false;
    layout(atlas);
  }
  atlas.stage.motions.forEach(print => paintPrint(atlas.stage, print, time));
  settlePins(atlas.stage, atlas.pins.values());
  if (atlas.stage.motions.size || atlas.layoutPending) requestFrame(atlas);
}

/**
 * Current poses of all prints, read before any changes parents or hover targets.
 * @param {Atlas} atlas
 * @param {number} time
 */
function snapshotPrints(atlas, time) {
  const { stage } = atlas;
  stage.motions.forEach(print => paintPrint(stage, print, time));
  return new Map(
    [...stage.prints.values()].map(print => [print.photo.id, snapshotPrint(stage, print)])
  );
}

/**
 * Pins for clusters, reusing pins whose photos are unchanged.
 * @param {Atlas} atlas
 * @param {{items: Photo[]}[]} groups
 */
function placePins(atlas, groups) {
  const { map, L } = atlas;
  /** @type {Map<string, Pin>} */
  const active = new Map();
  /** @type {Map<string, Owner>} */
  const owners = new Map();
  groups.forEach(group => {
    const key = groupKey(group.items);
    const position =
      group.items.length > 1
        ? map.unproject(
            L.bounds(group.items.map(photo => map.project(photo.coords, 0))).getCenter(),
            0
          )
        : group.items[0].coords;
    const pin = atlas.pins.get(key) || atlas.pinFactory.create(group, position);
    pin.marker.setLatLng(position);
    active.set(key, pin);
    group.items.forEach((photo, index) => owners.set(photo.id, { pin, index }));
  });
  return { active, owners };
}

/**
 * Where a print moving to a new pin starts: its own pose, else the pose of the
 * print it was stacked behind (at its depth), else its old resting slot.
 * @param {Atlas} atlas
 * @param {{id: string, old: Owner | undefined, snapshots: Map<string, any>}} context
 */
function printSource(atlas, { id, old, snapshots }) {
  if (snapshots.has(id)) return snapshots.get(id);
  const rearId = old?.pin.items[Math.min(old.index, VISIBLE_PRINTS - 1)].id;
  const rear = snapshots.get(rearId);
  if (rear) return { ...rear, depth: rear.depth + atlas.depths.get(id) - atlas.depths.get(rearId) };
  return old ? restingState(atlas.stage, old.pin, old.index) : null;
}

/**
 * Moves each owned print into its pin. Only the visible prints of a settled
 * stack request thumbnails.
 * @param {Atlas} atlas
 * @param {{owners: Map<string, Owner>, oldOwners: Map<string, Owner>,
 *   snapshots: Map<string, any>, time: number}} change
 */
function assignPrints(atlas, { owners, oldOwners, snapshots, time }) {
  const { stage } = atlas;
  owners.forEach(({ pin, index }, id) => {
    const old = oldOwners.get(id);
    let print = stage.prints.get(id);
    if (!print && index >= VISIBLE_PRINTS) return;
    print ||= createPrint(stage, pin.items[index], index);
    if (print.pin === pin && print.index === index) return;
    placePrint(stage, print, {
      pin,
      index,
      source: printSource(atlas, { id, old, snapshots }),
      merging: pin.items.length > (old?.pin.items.length || 0),
      time,
      animate: !atlas.reduceMotion
    });
  });
  [...stage.prints.values()].forEach(print => {
    const hidden = print.index >= VISIBLE_PRINTS && !stage.motions.has(print);
    if (!owners.has(print.photo.id) || hidden) removePrint(stage, print);
  });
}

/**
 * Keeps keyboard focus on the pin that now holds the focused pin's photo.
 * @param {Atlas} atlas
 * @param {Pin | undefined} focused
 * @param {Map<string, Owner>} owners
 */
function restoreFocus(atlas, focused, owners) {
  if (!focused || [...atlas.pins.values()].includes(focused)) return;
  const nextPin = owners.get(focused.items[0].id)?.pin;
  if (nextPin) nextPin.marker.getElement().focus({ preventScroll: true });
  else atlas.map.getContainer().focus({ preventScroll: true });
}

/**
 * Regroups photos into pins for the current view, animating moved prints.
 * @param {Atlas} atlas
 */
function layout(atlas) {
  const { map, pins } = atlas;
  atlas.lastLayout = performance.now();
  const groups = clusterPhotos(atlas.visible ? atlas.photos : [], {
    project: atlas.projection.containerPoint,
    size: map.getSize(),
    spacing: photoSpacing(map.getZoom()),
    isVisible: coords => !map.isLocationVisible || map.isLocationVisible(coords)
  });
  /** @type {Map<string, Owner>} */
  const oldOwners = new Map();
  pins.forEach(pin => pin.items.forEach((photo, index) => oldOwners.set(photo.id, { pin, index })));
  const time = performance.now();
  const regrouping =
    groups.length !== pins.size || groups.some(group => !pins.has(groupKey(group.items)));
  const snapshots = regrouping && !atlas.reduceMotion ? snapshotPrints(atlas, time) : new Map();
  const focused = [...pins.values()].find(
    pin => pin.marker.getElement() === document.activeElement
  );
  const { active, owners } = placePins(atlas, groups);
  assignPrints(atlas, { owners, oldOwners, snapshots, time });
  const retained = new Set(active.values());
  pins.forEach(pin => {
    if (!retained.has(pin)) atlas.layer.removeLayer(pin.marker);
  });
  pins.clear();
  active.forEach((pin, key) => pins.set(key, pin));
  settlePins(atlas.stage, pins.values());
  syncSelectedPin(atlas);
  restoreFocus(atlas, focused, owners);
}

/** Lays out now and tells the map. @param {Atlas} atlas */
function relayout(atlas) {
  layout(atlas);
  atlas.options.onLayout();
}

/** @param {Atlas} atlas @param {AbortController} listeners */
function bindMap(atlas, listeners) {
  const { map, stage } = atlas;
  map.on('zoom move', () => {
    atlas.layoutPending = true;
    requestFrame(atlas);
  });
  map.on('moveend resize', () => {
    atlas.layoutPending = false;
    relayout(atlas);
  });
  map.on('unload', () => {
    if (atlas.frame !== null) cancelAnimationFrame(atlas.frame);
    stage.motions.clear();
    stage.prints.clear();
    atlas.viewer.destroy();
    listeners.abort();
  });
}

/**
 * Adds photo pins to the map and the photo viewer they open.
 * @param {any} map Leaflet map or the globe renderer
 * @param {{focus: (target: any) => (() => void) | void, onLayout: () => void}} options
 *   `focus` moves the camera (returning a cancel function when it will call
 *   `complete`); `onLayout` runs after pins change.
 */
export function installAtlasPhotos(map, { focus, onLayout }) {
  const elements = findViewerElements();
  if (!elements) return INERT_PHOTOS;
  map.createPane('photos');
  map.getPane('photos').style.zIndex = PHOTO_PANE_Z_INDEX;
  const atlas = createAtlas(map, { focus, onLayout });
  const listeners = new AbortController();
  atlas.pinFactory = createPinFactory({
    L: atlas.L,
    map,
    layer: atlas.layer,
    layerPoint: atlas.projection.layerPoint,
    select: items => select(atlas, items),
    signal: listeners.signal
  });
  atlas.viewer = createPhotoViewer(elements, {
    map,
    reduceMotion: atlas.reduceMotion,
    asset,
    containerPoint: atlas.projection.containerPoint,
    pins: {
      find: photo => pinOf(atlas, photo),
      sync: () => syncSelectedPin(atlas),
      thumbnail: photo => atlas.stage.prints.get(photo.id)?.node.querySelector('img')
    }
  });
  bindMap(atlas, listeners);
  const closeNow = () => {
    cancelFocus(atlas);
    if (atlas.viewer.isOpen()) atlas.viewer.finish(false);
  };
  return {
    setVisible(show) {
      if (atlas.visible === Boolean(show)) return;
      atlas.visible = Boolean(show);
      if (!atlas.visible) {
        atlas.pinFactory.releasePress();
        closeNow();
      }
      relayout(atlas);
    },
    load(records) {
      atlas.photos = normalizePhotos(records);
      atlas.depths.clear();
      photoDepths(atlas.photos).forEach((depth, id) => atlas.depths.set(id, depth));
      atlas.stage.prints.forEach(print =>
        print.node.style.setProperty('--photo-depth', String(atlas.depths.get(print.photo.id)))
      );
      relayout(atlas);
    },
    occupied: () =>
      [...atlas.pins.values()].map(pin => pin.marker.getElement().getBoundingClientRect()),
    cancel: closeNow,
    isOpen: atlas.viewer.isOpen,
    show: ids => {
      const items = atlas.photos.filter(photo => ids.includes(photo.id));
      if (items.length) select(atlas, items);
    }
  };
}
