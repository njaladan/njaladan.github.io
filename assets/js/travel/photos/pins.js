import { photoLabel } from './records.js';

// Map pins holding a stack of photo prints, with keyboard and press handling.

const PIN_SIZE = 48;
// The pin's tip sits below its box, at the photo's location.
const PIN_ANCHOR = [PIN_SIZE / 2, 56];
// Raises a focused pin above its neighbours.
const FOCUS_Z_OFFSET = 1000;

/**
 * @typedef {import('./records.js').Photo} Photo
 * @typedef {import('./prints.js').Pin} Pin
 */

/**
 * Transformed marker containers create independent stacking contexts. Use
 * positioned anchors instead so every physical print shares the photo pane's
 * depth order, even while it changes logical groups.
 * @param {any} L
 * @param {(coords: any) => any} layerPoint unrounded projection
 */
export function photoMarkerClass(L, layerPoint) {
  return L.Marker.extend({
    update() {
      if (this._icon && this._map) this._setPos(layerPoint(this._latlng));
      return this;
    },
    _setPos(point) {
      if (this._icon) {
        L.DomUtil.setPosition(this._icon, point);
        this._icon.style.transform = 'none';
        this._icon.style.left = `${point.x}px`;
        this._icon.style.top = `${point.y}px`;
      }
      this._zIndex = point.y + this.options.zIndexOffset;
      this._resetZIndex();
    },
    _updateZIndex() {
      if (this._icon) this._icon.style.zIndex = 'auto';
    }
  });
}

/**
 * Accessible name of a pin.
 * @param {Photo[]} items
 */
const pinLabel = items =>
  items.length > 1
    ? `${photoLabel(items[0])} · ${items.length} photos nearby`
    : `Photo at ${photoLabel(items[0])}`;

/** @param {Photo[]} items */
function pinContent(items) {
  const wrapper = document.createElement('span');
  wrapper.className = 'photo-pin-content';
  if (items.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'photo-pin-count';
    badge.textContent = String(items.length);
    wrapper.append(badge);
  }
  return wrapper;
}

/**
 * Creates pins on a layer. Pressing a pin shows a pressed state until the
 * pointer is released anywhere or the map starts moving.
 * @param {{L: any, map: any, layer: any, layerPoint: (coords: any) => any,
 *   select: (items: Photo[]) => void, signal: AbortSignal}} options
 */
export function createPinFactory({ L, map, layer, layerPoint, select, signal }) {
  const PhotoMarker = photoMarkerClass(L, layerPoint);
  /** @type {HTMLElement | null} */
  let pressed = null;
  function releasePress() {
    pressed?.classList.remove('photo-pin-pressed');
    pressed = null;
  }
  window.addEventListener('pointerup', releasePress, { signal });
  window.addEventListener('pointercancel', releasePress, { signal });
  map.on('dragstart zoomstart', releasePress);

  /**
   * @param {Pin} pin
   * @param {HTMLElement} node
   */
  function bindPin(pin, node) {
    node.addEventListener('pointerenter', () => {
      pin.interacted = true;
    });
    node.addEventListener('pointerdown', () => {
      pin.interacted = true;
      releasePress();
      pressed = node;
      node.classList.add('photo-pin-pressed');
    });
    node.addEventListener('focus', () => {
      pin.interacted = true;
      pin.marker.setZIndexOffset(FOCUS_Z_OFFSET);
    });
    node.addEventListener('blur', () => {
      pin.marker.setZIndexOffset(0);
      releasePress();
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(pin.items);
      }
    });
  }

  /**
   * @param {{items: Photo[]}} group
   * @param {any} position
   * @returns {Pin}
   */
  function create({ items }, position) {
    const label = pinLabel(items);
    const content = pinContent(items);
    const marker = new PhotoMarker(position, {
      pane: 'photos',
      alt: label,
      icon: L.divIcon({
        className: `photo-pin${items.length > 1 ? ' photo-pin-stack' : ''}`,
        html: content,
        iconSize: [PIN_SIZE, PIN_SIZE],
        iconAnchor: PIN_ANCHOR
      }),
      riseOnHover: true
    }).addTo(layer);
    marker.on('click', () => {
      releasePress();
      select(items);
    });
    const node = marker.getElement();
    node.setAttribute('aria-haspopup', 'dialog');
    node.setAttribute('aria-label', label);
    const pin = { marker, content, items, interacted: false };
    bindPin(pin, node);
    return pin;
  }

  return { create, releasePress };
}
