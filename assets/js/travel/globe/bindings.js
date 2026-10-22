// Leaflet's tooltip and popup binding API for the globe's layers, and DOM
// event forwarding from their SVG paths and marker icons.
import { Popup, Tooltip } from './popups.js';

const FORWARDED_EVENTS = ['click', 'mouseover', 'mouseout', 'mousemove'];

/** Mixin for layers that can carry a tooltip and a popup. */
export const bindings = {
  bindTooltip(content, options) {
    this._tooltip = content instanceof Tooltip ? content : new Tooltip(options).setContent(content);
    this._tooltip._source = this;
    this.on('mouseover', event => {
      if (!this._tooltip.options.permanent) this.openTooltip(event.latlng);
    });
    this.on('mouseout', () => {
      if (!this._tooltip.options.permanent) this.closeTooltip();
    });
    return this;
  },
  openTooltip(coords) {
    if (this._tooltip && this._map) {
      this._tooltip
        .setLatLng(coords || this.getLatLng?.() || this.getBounds().getCenter())
        .addTo(this._map);
    }
    return this;
  },
  closeTooltip() {
    this._tooltip?.remove();
    return this;
  },
  getTooltip() {
    return this._tooltip;
  },
  isTooltipOpen() {
    return Boolean(this._tooltip?._map);
  },
  bindPopup(content, options) {
    this._popup = new Popup(options, this).setContent(content);
    this.on('click', event => this.openPopup(event.latlng));
    return this;
  },
  openPopup(coords) {
    if (this._popup && this._map) {
      this._popup
        .setLatLng(coords || this.getLatLng?.() || this.getBounds().getCenter())
        .openOn(this._map);
    }
    return this;
  },
  closePopup() {
    this._popup?.remove();
    return this;
  },
  getPopup() {
    return this._popup;
  },
  isPopupOpen() {
    return Boolean(this._popup?._map);
  }
};

/**
 * Fires Leaflet-style mouse events on `layer` for DOM events on its element,
 * with the pointer's map position. Sticky tooltips follow the pointer.
 * @param {any} layer
 * @param {Element} element
 */
export function bindDOM(layer, element) {
  for (const name of FORWARDED_EVENTS) {
    element.addEventListener(name, originalEvent => {
      if (name === 'click') originalEvent.stopPropagation();
      const latlng = layer._map?.containerPointToLatLng(
        layer._map.mouseEventToContainerPoint(originalEvent)
      );
      layer.fire(name, { originalEvent, latlng });
      if (name === 'mousemove' && layer._tooltip?.options.sticky) layer._tooltip.setLatLng(latlng);
    });
  }
}

/** Mixin swapping an SVG path's data only when it changes. */
export const pathData = {
  _setPath(d) {
    if (this._d !== d) {
      this._d = d;
      this._path.setAttribute('d', d);
    }
  }
};
