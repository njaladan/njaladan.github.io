// Leaflet markers placed over the MapLibre canvas, hidden behind the globe.
import { bindDOM, bindings } from './bindings.js';

const base = window.L;

export const Marker = base.Marker.extend({
  ...bindings,
  onAdd(map) {
    this._icon = this.options.icon.createIcon();
    this._icon.classList.add('leaflet-interactive');
    this._icon.style.pointerEvents = this.options.interactive === false ? 'none' : 'auto';
    if (this.options.keyboard !== false) {
      this._icon.tabIndex = 0;
      this._icon.setAttribute('role', 'button');
    }
    if (this.options.title) this._icon.title = this.options.title;
    if (this.options.riseOnHover) {
      this._icon.addEventListener('mouseenter', () => this._bringToFront());
      this._icon.addEventListener('mouseleave', () => this._resetZIndex());
    }
    map.getPane(this.options.pane || 'markerPane').append(this._icon);
    bindDOM(this, this._icon);
    this.update();
    if (this._tooltip?.options.permanent) this.openTooltip();
  },
  onRemove() {
    this.closeTooltip();
    this.closePopup();
    this._icon?.remove();
  },
  update() {
    if (!this._map || !this._icon) return this;
    const hidden = !this._map.isLocationVisible(this._latlng);
    if (this._icon.hidden !== hidden) this._icon.hidden = hidden;
    if (!hidden) this._setPos(this._map.latLngToLayerPoint(this._latlng));
    this._tooltip?.update();
    return this;
  },
  _setPos(position) {
    base.DomUtil.setPosition(this._icon, position);
    // Restacking hundreds of markers restyles each one. Vertical order barely
    // changes mid-gesture, so it is settled once the camera stops.
    if (this._map._moving) return;
    this._zIndex = Math.round(position.y) + (this.options.zIndexOffset || 0);
    this._resetZIndex();
  },
  _updateZIndex(offset) {
    const z = String(this._zIndex + (offset || 0));
    if (this._icon && this._icon.style.zIndex !== z) this._icon.style.zIndex = z;
  }
});
