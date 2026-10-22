// Leaflet-compatible tooltips and popups. Tooltips stay in the overlay panes;
// popups are MapLibre popups that keep Leaflet's markup, events and autopan.
import { panOverflow } from './math.js';

const base = window.L;
const DEFAULT_MAX_WIDTH = 320;
// Pixels between a popup's tip and its anchor.
const POPUP_OFFSET = 12;
// Default autopan padding: the top leaves room for the page header.
const PAN_PADDING_TOP_LEFT = [20, 70];
const PAN_PADDING_BOTTOM_RIGHT = [20, 20];
const PAN_SECONDS = 0.25;

export const Tooltip = base.Tooltip.extend({
  onAdd(map) {
    if (!this._container) this._initLayout();
    map.getPane(this.options.pane || 'tooltipPane').append(this._container);
    this._updateContent();
    this.update();
  },
  onRemove() {
    this._container?.remove();
  },
  update() {
    if (this._map && this._container && this._latlng) {
      this._container.hidden = !this._map.isLocationVisible(this._latlng);
      if (!this._container.hidden) this._updatePosition();
    }
    return this;
  }
});

/**
 * Leaflet's popup markup: a content wrapper holding the body and close button.
 * @param {(event: MouseEvent) => void} onClose
 * @returns {{ wrapper: HTMLDivElement, body: HTMLDivElement }}
 */
function popupFrame(onClose) {
  const wrapper = document.createElement('div');
  wrapper.className = 'leaflet-popup-content-wrapper';
  const body = document.createElement('div');
  body.className = 'leaflet-popup-content';
  wrapper.append(body);
  const close = document.createElement('a');
  close.href = '#';
  close.className = 'leaflet-popup-close-button';
  close.setAttribute('role', 'button');
  close.setAttribute('aria-label', 'Close popup');
  close.textContent = '×';
  close.onclick = onClose;
  wrapper.append(close);
  return { wrapper, body };
}

export const Popup = base.Popup.extend({
  initialize(options, source) {
    base.setOptions(this, options);
    this._source = source;
  },
  setContent(content) {
    this._content = content;
    this._contentDirty = true;
    if (this._map) this.update();
    return this;
  },
  setLatLng(coords) {
    this._latlng = base.latLng(coords);
    this._native?.setLngLat([this._latlng.lng, this._latlng.lat]);
    return this;
  },
  openOn(map) {
    if (this._map === map) {
      this.update();
      return this;
    }
    map.closePopup();
    map.addLayer(this);
    return this;
  },
  onAdd(map) {
    const { wrapper, body } = popupFrame(event => {
      event.preventDefault();
      event.stopPropagation();
      this.remove();
    });
    this._contentNode = body;
    this._native = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      maxWidth: `${this.options.maxWidth || DEFAULT_MAX_WIDTH}px`,
      className: `leaflet-popup ${this.options.className || ''}`,
      offset: POPUP_OFFSET
    })
      .setLngLat([this._latlng.lng, this._latlng.lat])
      .setDOMContent(wrapper)
      .addTo(map.nativeMap);
    this._native.on('close', () => {
      if (this._map) this.remove();
    });
    map._popup = this;
    this._contentDirty = true;
    this.update();
    map.fire('popupopen', { popup: this });
    this._source?.fire('popupopen', { popup: this });
  },
  onRemove(map) {
    const native = this._native;
    this._native = null;
    if (map._popup === this) map._popup = null;
    native?.remove();
    map.fire('popupclose', { popup: this });
    this._source?.fire('popupclose', { popup: this });
  },
  update() {
    if (!this._contentNode || !this._map) return this;
    if (!this._contentDirty) return this;
    this._contentDirty = false;
    const content =
      typeof this._content === 'function' ? this._content(this._source) : this._content;
    // Content is markup the application builds and escapes, as with Leaflet.
    if (typeof content === 'string') this._contentNode.innerHTML = content;
    else if (content) this._contentNode.replaceChildren(content);
    this._native.setLngLat([this._latlng.lng, this._latlng.lat]);
    if (this.options.autoPan !== false) requestAnimationFrame(() => this._adjustPan());
    return this;
  },
  getElement() {
    return this._native?.getElement();
  },
  isOpen() {
    return Boolean(this._map);
  },
  _adjustPan() {
    if (!this._map || !this.getElement()) return;
    const [x, y] = panOverflow(
      this.getElement().getBoundingClientRect(),
      this._map.getContainer().getBoundingClientRect(),
      this.options.autoPanPaddingTopLeft || PAN_PADDING_TOP_LEFT,
      this.options.autoPanPaddingBottomRight || PAN_PADDING_BOTTOM_RIGHT
    );
    if (x || y) this._map.panBy([x, y], { duration: PAN_SECONDS });
  }
});
