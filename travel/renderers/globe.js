// Renderer adapter for the atlas's existing layer/camera contract. Application
// state, cards, photos, labels, settings and itineraries stay in the shared app.
// Leaflet supplies geometry utilities and layer base classes; it does not create
// a second map here. MapLibre owns the camera, globe, basemap and 3D flights.
(() => {
  const base = window.L, NS = 'http://www.w3.org/2000/svg';
  const point = base.point, latLng = base.latLng, stamp = base.Util.stamp;
  // Recorded routes hold thousands of GPS points each. Simplify them once per
  // whole zoom level to within a pixel, rather than projecting every point
  // on every camera frame. Outlines share their line's geometry and result.
  const simplified = new WeakMap();
  function simplify(geometry, segments, zoom) {
    const level = Math.max(0, Math.floor(zoom));
    let levels = simplified.get(geometry);
    if (!levels) simplified.set(geometry, levels = new Map());
    if (!levels.has(level)) {
      const tolerance = 1 / (512 * 2 ** (level + 1));
      levels.set(level, segments.map(segment => base.LineUtil.simplify(segment.map(coords => {
        const p = maplibregl.MercatorCoordinate.fromLngLat([coords.lng, coords.lat]), item = point(p.x, p.y); item.latlng = coords; return item;
      }), tolerance).map(item => item.latlng)));
    }
    return levels.get(level);
  }
  // MapLibre lights the atmosphere from a fixed screen direction unless the
  // light is anchored to the map. Point that light at today's subsolar point
  // so the bright limb turns with the Earth and follows the real sun.
  function sunLight(date = new Date()) {
    const rad = Math.PI / 180, days = date / 864e5 - 10957.5;
    const mean = 280.46 + .9856474 * days, anomaly = (357.528 + .9856003 * days) * rad;
    const ecliptic = (mean + 1.915 * Math.sin(anomaly) + .02 * Math.sin(2 * anomaly)) * rad, tilt = (23.439 - 4e-7 * days) * rad;
    const lat = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
    const lng = Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic)) - (280.46061837 + 360.98564736629 * days) * rad;
    // Globe frame: x east at 90°, y north, z out of 0°, 0°. MapLibre's light
    // position is spherical and points away from the sun.
    const x = -Math.sin(lng) * Math.cos(lat), y = -Math.sin(lat), z = -Math.cos(lng) * Math.cos(lat);
    return {anchor: 'map', position: [1.15, Math.atan2(y, x) / rad - 90, Math.acos(z) / rad]};
  }
  const bindings = {
    bindTooltip(content, options) {
      this._tooltip = content instanceof Tooltip ? content : new Tooltip(options).setContent(content);
      this._tooltip._source = this;
      this.on('mouseover', event => { if (!this._tooltip.options.permanent) this.openTooltip(event.latlng); });
      this.on('mouseout', () => { if (!this._tooltip.options.permanent) this.closeTooltip(); });
      return this;
    },
    openTooltip(coords) {
      if (this._tooltip && this._map) this._tooltip.setLatLng(coords || this.getLatLng?.() || this.getBounds().getCenter()).addTo(this._map);
      return this;
    },
    closeTooltip() { this._tooltip?.remove(); return this; },
    getTooltip() { return this._tooltip; },
    isTooltipOpen() { return Boolean(this._tooltip?._map); },
    bindPopup(content, options) {
      this._popup = new Popup(options, this).setContent(content);
      this.on('click', event => this.openPopup(event.latlng)); return this;
    },
    openPopup(coords) {
      if (this._popup && this._map) this._popup.setLatLng(coords || this.getLatLng?.() || this.getBounds().getCenter()).openOn(this._map);
      return this;
    },
    closePopup() { this._popup?.remove(); return this; },
    getPopup() { return this._popup; },
    isPopupOpen() { return Boolean(this._popup?._map); }
  };
  function bindDOM(layer, element) {
    for (const name of ['click', 'mouseover', 'mouseout', 'mousemove']) element.addEventListener(name, originalEvent => {
      if (name === 'click') originalEvent.stopPropagation();
      const latlng = layer._map?.containerPointToLatLng(layer._map.mouseEventToContainerPoint(originalEvent));
      layer.fire(name, {originalEvent, latlng});
      if (name === 'mousemove' && layer._tooltip?.options.sticky) layer._tooltip.setLatLng(latlng);
    });
  }
  const Marker = base.Marker.extend({
    ...bindings,
    onAdd(map) {
      this._icon = this.options.icon.createIcon();
      this._icon.classList.add('leaflet-interactive'); this._icon.style.pointerEvents = this.options.interactive === false ? 'none' : 'auto';
      if (this.options.keyboard !== false) { this._icon.tabIndex = 0; this._icon.setAttribute('role', 'button'); }
      if (this.options.title) this._icon.title = this.options.title;
      if (this.options.riseOnHover) {
        this._icon.addEventListener('mouseenter', () => this._bringToFront());
        this._icon.addEventListener('mouseleave', () => this._resetZIndex());
      }
      map.getPane(this.options.pane || 'markerPane').append(this._icon); bindDOM(this, this._icon);
      this.update(); if (this._tooltip?.options.permanent) this.openTooltip();
    },
    onRemove() { this.closeTooltip(); this.closePopup(); this._icon?.remove(); },
    update() {
      if (!this._map || !this._icon) return this;
      const hidden = !this._map.isLocationVisible(this._latlng);
      if (this._icon.hidden !== hidden) this._icon.hidden = hidden;
      if (!hidden) this._setPos(this._map.latLngToLayerPoint(this._latlng));
      this._tooltip?.update(); return this;
    },
    _setPos(position) {
      base.DomUtil.setPosition(this._icon, position);
      // Restacking hundreds of markers restyles each one. Vertical order barely
      // changes mid-gesture, so it is settled once the camera stops.
      if (this._map._moving) return;
      this._zIndex = Math.round(position.y) + (this.options.zIndexOffset || 0); this._resetZIndex();
    },
    _updateZIndex(offset) { const z = String(this._zIndex + (offset || 0)); if (this._icon && this._icon.style.zIndex !== z) this._icon.style.zIndex = z; }
  });
  const Tooltip = base.Tooltip.extend({
    onAdd(map) {
      if (!this._container) this._initLayout();
      map.getPane(this.options.pane || 'tooltipPane').append(this._container);
      this._updateContent(); this.update();
    },
    onRemove() { this._container?.remove(); },
    update() {
      if (this._map && this._container && this._latlng) {
        this._container.hidden = !this._map.isLocationVisible(this._latlng);
        if (!this._container.hidden) this._updatePosition();
      }
      return this;
    }
  });
  const Popup = base.Popup.extend({
    initialize(options, source) { base.setOptions(this, options); this._source = source; },
    setContent(content) { this._content = content; this._contentDirty = true; if (this._map) this.update(); return this; },
    setLatLng(coords) { this._latlng = latLng(coords); this._native?.setLngLat([this._latlng.lng, this._latlng.lat]); return this; },
    openOn(map) {
      if (this._map === map) { this.update(); return this; }
      map.closePopup(); map.addLayer(this); return this;
    },
    onAdd(map) {
      const content = document.createElement('div'); content.className = 'leaflet-popup-content-wrapper';
      this._contentNode = document.createElement('div'); this._contentNode.className = 'leaflet-popup-content'; content.append(this._contentNode);
      const close = document.createElement('a'); close.href = '#'; close.className = 'leaflet-popup-close-button'; close.setAttribute('role', 'button'); close.setAttribute('aria-label', 'Close popup'); close.textContent = '×';
      close.onclick = event => { event.preventDefault(); event.stopPropagation(); this.remove(); }; content.append(close);
      this._native = new maplibregl.Popup({closeButton: false, closeOnClick: false, focusAfterOpen: false, maxWidth: `${this.options.maxWidth || 320}px`, className: `leaflet-popup ${this.options.className || ''}`, offset: 12})
        .setLngLat([this._latlng.lng, this._latlng.lat]).setDOMContent(content).addTo(map.nativeMap);
      this._native.on('close', () => { if (this._map) this.remove(); });
      map._popup = this; this._contentDirty = true; this.update();
      map.fire('popupopen', {popup: this}); this._source?.fire('popupopen', {popup: this});
    },
    onRemove(map) {
      const native = this._native; this._native = null; if (map._popup === this) map._popup = null;
      native?.remove(); map.fire('popupclose', {popup: this}); this._source?.fire('popupclose', {popup: this});
    },
    update() {
      if (!this._contentNode || !this._map) return this;
      if (!this._contentDirty) return this;
      this._contentDirty = false;
      const content = typeof this._content === 'function' ? this._content(this._source) : this._content;
      if (typeof content === 'string') this._contentNode.innerHTML = content;
      else if (content) this._contentNode.replaceChildren(content);
      this._native.setLngLat([this._latlng.lng, this._latlng.lat]);
      if (this.options.autoPan !== false) requestAnimationFrame(() => this._adjustPan());
      return this;
    },
    getElement() { return this._native?.getElement(); },
    isOpen() { return Boolean(this._map); },
    _adjustPan() {
      if (!this._map || !this.getElement()) return;
      const box = this.getElement().getBoundingClientRect(), root = this._map.getContainer().getBoundingClientRect();
      const tl = this.options.autoPanPaddingTopLeft || [20, 70], br = this.options.autoPanPaddingBottomRight || [20, 20];
      const x = box.right > root.right - br[0] ? box.right - root.right + br[0] : box.left < root.left + tl[0] ? box.left - root.left - tl[0] : 0;
      const y = box.bottom > root.bottom - br[1] ? box.bottom - root.bottom + br[1] : box.top < root.top + tl[1] ? box.top - root.top - tl[1] : 0;
      if (x || y) this._map.panBy([x, y], {duration: .25});
    }
  });
  const Polyline = base.Polyline.extend({
    ...bindings,
    initialize(coords, options) {
      this._atlasGeometry = coords;
      base.Polyline.prototype.initialize.call(this, coords, options);
    },
    onAdd(map) {
      this._path = document.createElementNS(NS, 'path'); this._path.classList.add('leaflet-interactive');
      if (this.options.className) this._path.classList.add(...this.options.className.split(/\s+/).filter(Boolean));
      map.getSVG(this.options.pane || 'overlayPane').append(this._path); bindDOM(this, this._path);
      if (this.options.pane === 'flights') { this._flightIndex = map._flightLines.length; map._flightLines.push(this); }
      this.setStyle(this.options); this.update();
    },
    onRemove() { this.closeTooltip(); this.closePopup(); this._path?.remove(); },
    getElement() { return this._path; },
    setStyle(options) {
      Object.assign(this.options, options);
      if (this._path) {
        this._path.setAttribute('fill', 'none'); this._path.setAttribute('stroke', this.options.color || '#3388ff');
        this._path.setAttribute('stroke-width', this.options.weight || 3); this._path.setAttribute('stroke-opacity', this.options.opacity ?? 1);
        this._path.style.pointerEvents = this.options.interactive === false ? 'none' : 'stroke';
        if (this.options.pane === 'flights') this._map?._flightLayer?.setStyle(this._flightIndex, this.options);
      }
      return this;
    },
    bringToFront() { if (this._path) this._path.parentNode?.append(this._path); return this; },
    update() {
      if (!this._map || !this._path) return this;
      const map = this._map, size = map.getSize(), parts = [];
      const flight = this.options.pane === 'flights';
      const visible = flight ? Math.max(0, Math.min(1, (map.nativeMap.getZoom() - 4.5) / 1.5)) : 1;
      // Invisible hit lines are not needed mid-gesture, and raised flights draw
      // in WebGL until the flat lines fade in. Neither needs projecting then.
      const hitOnly = this.options.opacity === 0 && map._moving;
      if (!visible || hitOnly || !flight && this.options.pane === 'routes' && map.getZoom() < 3 || !this.getBounds().intersects(map.getBounds())) {
        this._parts = []; this._setPath(''); return this;
      }
      const cache = this.options.pane === 'routes' ? map._pathCache : null;
      const cached = cache?.get(this._atlasGeometry);
      if (cached) { this._parts = cached.parts; this._setPath(cached.path); return this; }
      const segments = simplify(this._atlasGeometry, Array.isArray(this._latlngs[0]) ? this._latlngs : [this._latlngs], map.nativeMap.getZoom());
      const clip = base.bounds([[-80, -80], [size.x + 80, size.y + 80]]);
      segments.forEach(segment => {
        let current = [], previous = null;
        segment.forEach(coords => {
          if (!map.isLocationVisible(coords)) { if (current.length > 1) parts.push(current); current = []; previous = null; return; }
          const projected = map.latLngToLayerPoint(coords);
          if (previous) {
            const pair = base.LineUtil.clipSegment(previous, projected, clip, false, true);
            if (pair) { if (!current.length) current.push(pair[0]); current.push(pair[1]); }
            else { if (current.length > 1) parts.push(current); current = []; }
          }
          previous = projected;
        });
        if (current.length > 1) parts.push(current);
      });
      this._parts = parts;
      const path = parts.map(part => `M${part.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}`).join('');
      this._setPath(path);
      cache?.set(this._atlasGeometry, {parts, path});
      if (flight) {
        this._path.style.strokeOpacity = String(visible * (this.options.opacity ?? .43));
        this._path.style.pointerEvents = visible > .5 ? 'stroke' : 'none';
      }
      return this;
    },
    _setPath(d) { if (this._d !== d) { this._d = d; this._path.setAttribute('d', d); } }
  });
  const Polygon = base.Polygon.extend({
    ...bindings,
    onAdd(map) {
      map._polygons.add(this);
      this._path = document.createElementNS(NS, 'path'); this._path.setAttribute('class', `leaflet-interactive ${this.options.className || ''}`);
      this._path.setAttribute('fill', 'transparent'); this._path.setAttribute('stroke', 'none');
      this._path.style.pointerEvents = this.options.interactive === false ? 'none' : 'fill';
      map.getSVG(this.options.pane || 'overlayPane').append(this._path); bindDOM(this, this._path); this.update(); map.queueStyle(true);
    },
    onRemove(map) { this.closePopup(); this.closeTooltip(); map._polygons.delete(this); this._path?.remove(); map.queueStyle(true); },
    getElement() { return this._path; },
    setStyle(style) { Object.assign(this.options, style); this._map?.queueStyle(true); return this; },
    update() {
      if (!this._path || !this._map) return;
      const pane = this._map.getPane(this.options.pane || 'overlayPane');
      // Geographic paint lives in WebGL. SVG exists only for hit targets, so
      // invisible states need no vertex projection while the world rotates.
      // Hit areas are also skipped mid-gesture and rebuilt when the camera stops.
      if (this.options.interactive === false || this._map._moving || pane.hidden || pane.style.pointerEvents === 'none' || !this.getBounds().intersects(this._map.getBounds())) { this._setPath(''); return; }
      const polygons = this.feature.geometry.type === 'Polygon' ? [this.feature.geometry.coordinates] : this.feature.geometry.coordinates;
      this._setPath(polygons.map(polygon => polygon.map(ring => {
        const points = ring.map(([lon, lat]) => this._map.isLocationVisible([lat, lon]) ? this._map.latLngToLayerPoint([lat, lon]) : null).filter(Boolean);
        return points.length > 2 ? `M${points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z` : '';
      }).join('')).join(''));
    },
    _setPath(d) { if (this._d !== d) { this._d = d; this._path.setAttribute('d', d); } }
  });
  const Group = base.LayerGroup.extend({
    setStyle(style) { this.eachLayer(layer => layer.setStyle?.(typeof style === 'function' ? style(layer.feature) : style)); return this; }
  });
  const Tile = base.TileLayer.extend({
    onAdd(map) { map._tiles.add(this); map.queueStyle(); },
    onRemove(map) { map._tiles.delete(this); map.queueStyle(); }
  });
  const GlobeMap = base.Evented.extend({
    initialize(id, options) {
      this.options = options; this._container = document.getElementById(id); this._container.classList.add('leaflet-container', 'atlas-globe'); this._container.tabIndex = 0;
      this._layers = {}; this._panes = {}; this._svgs = {}; this._polygons = new Set(); this._tiles = new Set(); this._flightLines = [];
      this._dirtyData = true; this._frame = null; this._styleFrame = null; this._manual = false; this._removed = false;
      this.nativeMap = new maplibregl.Map({container: id, center: [10, 25], zoom: innerWidth < 700 ? 1.05 : 1.95, minZoom: 0, maxZoom: 16, maxPitch: 0,
        attributionControl: false, pixelRatio: Math.min(devicePixelRatio, 1.5), canvasContextAttributes: {antialias: false},
        style: {version: 8, sky: {'sky-color': '#faf8f3', 'horizon-color': '#faf8f3', 'fog-color': '#fff', 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, .15, 4, .15, 6, 0]}, light: sunLight(),
          projection: {type: ['interpolate', ['linear'], ['zoom'], 3, 'vertical-perspective', 6, 'mercator']}, sources: {}, layers: [{id: 'atlas-ocean', type: 'background', paint: {'background-color': '#dfe6e8'}}]}});
      this._overlayRoot = document.createElement('div'); this._overlayRoot.className = 'leaflet-map-pane atlas-overlay-root'; this.nativeMap.getCanvasContainer().append(this._overlayRoot);
      for (const pane of ['overlayPane', 'markerPane', 'tooltipPane', 'popupPane']) this.createPane(pane);
      this.getPane('tooltipPane').style.zIndex = 650; this.getPane('markerPane').style.zIndex = 600;
      this._paneObserver = new MutationObserver(() => this.queueStyle());
      this._attributions = new Set(); this._attribution = new maplibregl.AttributionControl({compact: true, customAttribution: 'MapLibre'}); this.nativeMap.addControl(this._attribution);
      this.attributionControl = {setPrefix() {}, addAttribution: text => {this._attributions.add(text); this._attribution.options.customAttribution = [...this._attributions]; this._attribution._updateAttributions();}};
      this.ready = new Promise(resolve => this.nativeMap.once('load', () => { this._loaded = true; this.queueStyle(true); this.queueRender(); resolve(); }));
      this.ready.then(() => this.spin());
      this._sunTimer = setInterval(() => this.nativeMap.setLight(sunLight()), 6e5);
      ['movestart', 'move', 'moveend', 'zoomstart', 'zoom', 'zoomend', 'dragstart', 'resize'].forEach(type => this.nativeMap.on(type, event => {
        this._boundsCache = null;
        if (type === 'resize') this._sizeCache = null;
        if (type === 'movestart') { this._panAnim = {_inProgress: true}; this._flyToFrame = 1; this._moving = true; }
        if (type === 'moveend') { this._panAnim = {_inProgress: false}; this._flyToFrame = null; this._moving = false; }
        // MapLibre fires move inside the frame it is about to draw. Placing the
        // overlay now keeps it on that frame; a queued update trails by one.
        if (type === 'move') this.renderNow();
        else if (type !== 'zoom') this.queueRender();
        if (!this._manual || !['movestart', 'moveend', 'zoomstart', 'zoomend'].includes(type)) this.fire(type, event);
      }));
      this.nativeMap.on('click', event => {
        if (!event.originalEvent.target.closest('.leaflet-marker-icon,.leaflet-interactive,.leaflet-popup,.leaflet-tooltip')) this.closePopup();
        this.fire('click', {latlng: latLng(event.lngLat.lat, event.lngLat.lng), originalEvent: event.originalEvent});
      });
      this._escapePopup = event => {
        if (event.key === 'Escape' && this._popup && this._popup.options.closeOnEscapeKey !== false) {
          event.stopPropagation(); this.closePopup();
        }
      };
      this._container.addEventListener('keydown', this._escapePopup);
    },
    createPane(name) {
      if (this._panes[name]) return this._panes[name];
      const pane = document.createElement('div'); pane.className = `leaflet-pane leaflet-${name.replace(/Pane$/, '')}-pane`; pane.dataset.atlasPane = name;
      this._overlayRoot.append(pane); this._panes[name] = pane;
      this._paneObserver?.observe(pane, {attributes: true, attributeFilter: ['style', 'hidden']}); return pane;
    },
    getPane(name) { return this._panes[name] || this.createPane(name); },
    getSVG(name) {
      if (!this._svgs[name]) {
        const svg = document.createElementNS(NS, 'svg'); svg.classList.add('atlas-vector-pane'); this.getPane(name).append(svg); this._svgs[name] = svg;
      }
      return this._svgs[name];
    },
    getContainer() { return this._container; },
    getSize() { return this._sizeCache ||= point(this._container.clientWidth, this._container.clientHeight); },
    getCenter() { const c = this.nativeMap.getCenter(); return latLng(c.lat, c.lng); },
    getZoom() { return this.nativeMap.getZoom() + 1; },
    getMinZoom() { return 1; }, getMaxZoom() { return 17; },
    getZoomScale(to, from = this.getZoom()) { return 2 ** (to - from); },
    getScaleZoom(scale, from = this.getZoom()) { return from + Math.log2(scale); },
    getBounds() {
      if (!this._boundsCache) { const b = this.nativeMap.getBounds(); this._boundsCache = base.latLngBounds([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]); }
      return this._boundsCache;
    },
    getBoundsZoom(bounds, inside, padding = [0, 0]) {
      bounds = base.latLngBounds(bounds);
      const size = this.getSize().subtract(point(padding));
      const extent = base.bounds([this.project(bounds.getNorthWest(), 0), this.project(bounds.getSouthEast(), 0)]).getSize();
      const scale = (inside ? Math.max : Math.min)(size.x / extent.x, size.y / extent.y);
      return Math.max(this.getMinZoom(), Math.min(this.getMaxZoom(), this.getScaleZoom(scale, 0)));
    },
    isLocationVisible(coords) { coords = latLng(coords); return !this.nativeMap.transform.isLocationOccluded(new maplibregl.LngLat(coords.lng, coords.lat)); },
    project(coords, zoom) { coords = latLng(coords); if (zoom !== undefined) return base.CRS.EPSG3857.latLngToPoint(coords, zoom); const p = this.nativeMap.project([coords.lng, coords.lat]); return point(p.x, p.y); },
    unproject(p, zoom) { p = point(p); if (zoom !== undefined) return base.CRS.EPSG3857.pointToLatLng(p, zoom); const coords = this.nativeMap.unproject([p.x, p.y]); return latLng(coords.lat, coords.lng); },
    latLngToLayerPoint(coords) { return this.project(coords); }, latLngToContainerPoint(coords) { return this.project(coords); },
    layerPointToContainerPoint(p) { return point(p); }, containerPointToLayerPoint(p) { return point(p); },
    containerPointToLatLng(p) { return this.unproject(p); }, layerPointToLatLng(p) { return this.unproject(p); },
    mouseEventToContainerPoint(event) { const box = this._container.getBoundingClientRect(); return point(event.clientX - box.left, event.clientY - box.top); },
    addLayer(layer) {
      const id = stamp(layer); if (this._layers[id]) return this;
      this._layers[id] = layer; layer._map = this; layer.onAdd?.(this); layer.fire('add'); return this;
    },
    removeLayer(layer) {
      const id = stamp(layer); if (!this._layers[id]) return this;
      delete this._layers[id]; layer._map = null; layer.onRemove?.(this); layer.fire('remove'); return this;
    },
    hasLayer(layer) { return Boolean(this._layers[stamp(layer)]); },
    eachLayer(fn) { Object.values(this._layers).forEach(fn); return this; },
    closePopup(popup = this._popup) { if (popup) this.removeLayer(popup); return this; },
    setView(coords, zoom = this.getZoom()) { coords = latLng(coords); this.nativeMap.jumpTo({center: [coords.lng, coords.lat], zoom: zoom - 1}); return this; },
    setZoom(zoom) { return this.setView(this.getCenter(), zoom); },
    flyTo(coords, zoom, options = {}) { coords = latLng(coords); this.nativeMap.flyTo({center: [coords.lng, coords.lat], zoom: zoom - 1, duration: options.animate === false ? 0 : (options.duration || 1.1) * 1000}); return this; },
    fitBounds(bounds, options = {}) {
      bounds = base.latLngBounds(bounds);
      if (bounds.getEast() - bounds.getWest() > 350 && bounds.getNorth() - bounds.getSouth() > 130) {
        const target = {center: [10, 25], zoom: innerWidth < 700 ? 1.05 : 1.95};
        if (options.animate) this.nativeMap.flyTo({...target, duration: (options.duration || 1.25) * 1000}); else this.nativeMap.jumpTo(target);
        return this;
      }
      const tl = point(options.paddingTopLeft || options.padding || [0, 0]), br = point(options.paddingBottomRight || options.padding || [0, 0]);
      // Use the atlas's continuous Mercator pixel scale for destination fits.
      // A fit calculated in the in-between globe projection can overshoot its
      // requested zoom and padding when the camera lands in Mercator.
      const zoom = Math.min(options.maxZoom ?? 17, this.getBoundsZoom(bounds, false, tl.add(br)));
      const center = this.unproject(this.project(bounds.getSouthWest(), zoom).add(this.project(bounds.getNorthEast(), zoom)).divideBy(2).add(br.subtract(tl).divideBy(2)), zoom);
      return options.animate === false ? this.setView(center, zoom) : this.flyTo(center, zoom, options);
    },
    flyToBounds(bounds, options) { return this.fitBounds(bounds, {...options, animate: true}); },
    panBy(offset, options = {}) { offset = point(offset); this.nativeMap.panBy([offset.x, offset.y], {duration: options.animate === false ? 0 : (options.duration || .3) * 1000, easing: t => 1 - (1 - t) ** 3}); return this; },
    stop() { this.nativeMap.stop(); return this; },
    _moveStart() { this._manual = true; this.fire('movestart'); this.fire('zoomstart'); return this; },
    _move(coords, zoom) { this.setView(coords, zoom); return this; },
    _moveEnd() { this._manual = false; this.fire('zoomend'); this.fire('moveend'); return this; },
    // The app settles its own zoom gestures here; that must not end the idle spin.
    installSmoothZoom() { return {finish: () => { if (this._spinTarget == null) this.nativeMap.stop(); }}; },
    queueRender() {
      if (this._frame !== null || this._removed) return;
      this._frame = requestAnimationFrame(() => { this._frame = null; this.renderNow(); });
    },
    renderNow() {
      if (this._removed) return;
      // Routes, outlines and click targets share their input coordinates.
      // Project and clip that geometry once for this camera frame.
      this._pathCache = new WeakMap();
      Object.values(this._layers).forEach(layer => layer.update?.());
      this._pathCache = null;
    },
    queueStyle(data = false) {
      this._dirtyData ||= data;
      if (!this._loaded || this._styleFrame !== null || this._removed) return;
      this._styleFrame = requestAnimationFrame(() => { this._styleFrame = null; this.syncStyle(); });
    },
    syncStyle() {
      // One geography source shares tile parsing and globe clipping meshes.
      // Panes remain separate styled layers, just as in the shared application.
      const source = 'atlas-geography', panes = new Map(), order = [];
      this._polygons.forEach(layer => {
        const name = layer.options.pane || 'overlayPane';
        const types = panes.get(name) || {fill: false, line: false};
        types.fill ||= layer.options.fill !== false && (layer.options.fillOpacity ?? .2) > 0;
        types.line ||= layer.options.stroke !== false && (layer.options.weight || 0) > 0;
        panes.set(name, types);
      });
      if (this._dirtyData || !this.nativeMap.getSource(source)) {
        const features = [...this._polygons].map(layer => ({...layer.feature, id: stamp(layer), properties: {...layer.feature.properties,
          atlasPane: layer.options.pane || 'overlayPane', fill: layer.options.fillColor || layer.options.color || '#fafafa',
          fillOpacity: layer.options.fill === false ? 0 : layer.options.fillOpacity ?? .2,
          color: layer.options.color || '#d9dde0', width: layer.options.stroke === false ? 0 : layer.options.weight || 0, opacity: layer.options.opacity ?? 1}}));
        const data = {type: 'FeatureCollection', features};
        if (this.nativeMap.getSource(source)) this.nativeMap.getSource(source).setData(data);
        else this.nativeMap.addSource(source, {type: 'geojson', data});
      }
      this._paneStyles ||= new Map();
      panes.forEach((types, name) => {
        const pane = this.getPane(name), prefix = `atlas-geography-${name}`, opacity = pane.hidden ? 0 : Number(pane.style.opacity || 1);
        const state = `${opacity}/${types.fill}/${types.line}`;
        for (const type of ['fill', 'line']) {
          const id = `${prefix}-${type}`, visible = opacity > 0 && types[type] ? 'visible' : 'none';
          const property = type === 'fill' ? 'fill-opacity' : 'line-opacity';
          const alpha = ['*', ['get', type === 'fill' ? 'fillOpacity' : 'opacity'], opacity];
          if (!this.nativeMap.getLayer(id)) {
            const paint = type === 'fill' ? {'fill-color': ['get', 'fill'], [property]: alpha} : {'line-color': ['get', 'color'], 'line-width': ['get', 'width'], [property]: alpha};
            this.nativeMap.addLayer({id, type, source, filter: ['==', ['get', 'atlasPane'], name], layout: {visibility: visible}, paint});
          } else if (this._paneStyles.get(name) !== state) {
            this.nativeMap.setLayoutProperty(id, 'visibility', visible); this.nativeMap.setPaintProperty(id, property, alpha);
          }
          order.push({id, rank: Number(pane.style.zIndex || 400) + (type === 'line' ? .1 : 0)});
        }
        this._paneStyles.set(name, state);
      });
      this._tileLayers ||= new Map();
      this._tileStyles ||= new Map();
      this._tiles.forEach(tile => {
        let id = this._tileLayers.get(tile);
        if (!id) {
          id = `atlas-tiles-${stamp(tile)}`; this._tileLayers.set(tile, id);
          this.nativeMap.addSource(id, {type: 'raster', tiles: [tile._url], tileSize: 256, maxzoom: tile.options.maxNativeZoom || 16, attribution: tile.options.attribution || ''});
          this.nativeMap.addLayer({id, type: 'raster', source: id, minzoom: Math.max(0, (tile.options.minZoom || 1) - 1), paint: {'raster-saturation': -1}});
        }
        const pane = this.getPane(tile.options.pane || 'overlayPane'), opacity = pane.hidden ? 0 : Number(pane.style.opacity || 1);
        if (this._tileStyles.get(id) !== opacity) {
          this.nativeMap.setLayoutProperty(id, 'visibility', opacity > 0 ? 'visible' : 'none'); this.nativeMap.setPaintProperty(id, 'raster-opacity', opacity);
          this._tileStyles.set(id, opacity);
        }
        order.push({id, rank: Number(pane.style.zIndex || 400)});
      });
      this._tileLayers.forEach((id, tile) => {
        if (!this._tiles.has(tile) && this._tileStyles.get(id) !== null) { this.nativeMap.setLayoutProperty(id, 'visibility', 'none'); this._tileStyles.set(id, null); }
      });
      order.sort((a, b) => a.rank - b.rank);
      const ordering = order.map(layer => layer.id).join('/');
      if (ordering !== this._layerOrdering) {
        order.forEach(({id}) => this.nativeMap.moveLayer(id, this._flightLayer ? this._flightLayer.id : undefined)); this._layerOrdering = ordering;
      }
      this._dirtyData = false;
    },
    configureFlights(log) {
      let hovered = null;
      this._flightLayer = createGlobeFlights(log, {
        onHover: (route, coords) => {
          const next = route ? this._flightLines[log.routes.indexOf(route)] : null;
          if (next === hovered) return;
          hovered?.fire('mouseout'); hovered = next;
          hovered?.fire('mouseover', {latlng: latLng(coords.lat, coords.lng)});
        },
        onSelect: (route, coords) => this._flightLines[log.routes.indexOf(route)]?.openPopup(latLng(coords.lat, coords.lng))});
      this.nativeMap.addLayer(this._flightLayer);
    },
    // Earth turns east, so the camera drifts west: a quick turn as the page
    // loads settles into a slow idle spin. Touching the globe holds it; once
    // the visitor lets go and the camera rests, it eases back into the drift.
    spin() {
      const map = this.nativeMap, container = this._container, idle = 12, burst = 90, settle = .8, first = 4, rest = 1500;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const travel = t => idle * t + (burst - idle) * settle * (1 - Math.exp(-t / settle));
      const rise = t => idle * (t - (1 - Math.exp(-t)));
      let held = false, dir = 1, samples = [];
      const turn = (degrees, seconds, easing) => {
        const {lng, lat} = map.getCenter();
        this._spinTarget = lng - degrees;
        map.easeTo({center: [this._spinTarget, lat], duration: seconds * 1000, easing, essential: true});
        // Any other camera change interrupts the ease before it lands.
        map.once('moveend', () => {
          const landed = this._spinTarget !== null && Math.abs(((map.getCenter().lng - this._spinTarget) % 360 + 540) % 360 - 180) < 1e-6;
          if (landed && !this._removed) turn(30 * dir, 30 / idle, t => t);
          else { this._spinTarget = null; resume(); }
        });
      };
      // Wait for the camera to rest. Zoomed in, open cards and the photo
      // viewer keep it still; the next camera move or closed card checks again.
      const resume = () => {
        clearTimeout(this._spinTimer);
        if (!this._spinning) return;
        this._spinTimer = setTimeout(() => {
          if (held || this._spinTarget !== null || map.isMoving() || map.getZoom() >= 3) return;
          if (this._popup || document.querySelector('dialog[open]')) return resume();
          turn(dir * rise(4), 4, t => rise(t * 4) / rise(4));
        }, rest);
      };
      // Even a click without a drag takes the camera, so halt the turn in progress.
      const halt = () => { dir = 1; clearTimeout(this._spinTimer); if (this._spinTarget !== null) { this._spinTarget = null; map.stop(); } };
      const press = () => { held = true; halt(); }, letGo = () => { if (held) { held = false; resume(); } };
      this._spinListeners = [[container, 'pointerdown', press], [window, 'pointerup', letGo], [window, 'pointercancel', letGo],
        [container, 'wheel', () => { halt(); resume(); }], [container, 'keydown', () => { halt(); resume(); }]];
      this._spinListeners.forEach(([target, type, listener]) => target.addEventListener(type, listener, {capture: true, passive: true}));
      // A throw keeps going: the release speed (westward degrees per second)
      // eases down to the idle drift in the direction it was thrown. Slower
      // flicks coast to a stop and wait like any other touch.
      map.on('dragstart', () => { samples = []; });
      map.on('move', event => {
        if (!event.originalEvent || !map.dragPan.isActive()) return;
        const now = performance.now(), lng = map.getCenter().lng, last = samples[samples.length - 1];
        samples.push({now, lng: last ? last.lng + ((lng - last.lng + 540) % 360 - 180) : lng});
        samples = samples.filter(sample => now - sample.now < 120 || sample === samples[samples.length - 1]);
      });
      map.on('dragend', () => {
        const first = samples[0], last = samples[samples.length - 1], recent = performance.now() - (last?.now ?? 0) < 250;
        samples = [];
        if (!first || first === last || !recent || map.getZoom() >= 3) return;
        const speed = Math.max(-400, Math.min(400, -(last.lng - first.lng) / ((last.now - first.now) / 1000)));
        if (Math.abs(speed) <= idle) return;
        setTimeout(() => {
          if (held || this._removed || !this._spinning) return;
          dir = Math.sign(speed);
          const floor = dir * idle, tau = 1.2, seconds = 4 * tau;
          const fling = t => floor * t + (speed - floor) * tau * (1 - Math.exp(-t / tau));
          map.stop();
          turn(fling(seconds), seconds, t => fling(t * seconds) / fling(seconds));
        });
      });
      this._spinning = true;
      map.on('moveend', () => { if (this._spinTarget === null) resume(); });
      this.on('popupclose', resume);
      if (map.getZoom() >= 3) return;
      const {lng, lat} = this._homeCenter = map.getCenter();
      map.jumpTo({center: [lng + travel(first), lat]});
      turn(travel(first), first, t => travel(t * first) / travel(first));
    },
    stopSpin() {
      this._spinning = false; clearTimeout(this._spinTimer);
      if (this._spinTarget != null) { this._spinTarget = null; this.nativeMap.stop(); }
      this._spinListeners?.forEach(([target, type, listener]) => target.removeEventListener(type, listener, true));
    },
    remove() {
      clearInterval(this._sunTimer); this.stopSpin();
      this._removed = true; this.fire('unload'); this._paneObserver.disconnect(); cancelAnimationFrame(this._frame); cancelAnimationFrame(this._styleFrame);
      this._container.removeEventListener('keydown', this._escapePopup);
      Object.values(this._layers).forEach(layer => this.removeLayer(layer)); this.nativeMap.remove(); return this;
    }
  });
  const renderer = Object.assign({}, base, {
    Marker, Tooltip, Popup, Polyline, Polygon, TileLayer: Tile,
    map: (id, options) => new GlobeMap(id, options), marker: (coords, options) => new Marker(coords, options),
    polyline: (coords, options) => new Polyline(coords, options), popup: options => new Popup(options),
    layerGroup: layers => new Group(layers), tileLayer: (url, options) => new Tile(url, options),
    geoJSON: (data, options = {}) => {
      const features = Array.isArray(data) ? data : data.type === 'FeatureCollection' ? data.features : [data];
      const group = new Group();
      features.forEach(feature => {
        const coordinates = base.GeoJSON.coordsToLatLngs(feature.geometry.coordinates, feature.geometry.type === 'MultiPolygon' ? 2 : 1);
        const layer = new Polygon(coordinates, {...options, ...(typeof options.style === 'function' ? options.style(feature) : options.style)});
        layer.feature = feature; options.onEachFeature?.(feature, layer); group.addLayer(layer);
      });
      return group;
    }
  });
  // The globe is the default view. Visitors can choose the flat Leaflet map
  // in settings, and browsers without WebGL fall back to it.
  const supported = (() => {
    if (typeof maplibregl === 'undefined') return false;
    try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; }
  })();
  let preferred = 'globe';
  try { if (localStorage.getItem('atlas-map-view') === 'flat') preferred = 'flat'; } catch {}
  window.ATLAS_GLOBE_SUPPORTED = supported;
  if (supported && preferred === 'globe') window.ATLAS_RENDERER = renderer;
})();
