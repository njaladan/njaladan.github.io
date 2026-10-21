function installBasemapLabels(map) {
  const L = map.atlasRenderer || window.L;
  map.createPane('backgroundLabels');
  map.getPane('backgroundLabels').style.zIndex = 390;
  map.getPane('backgroundLabels').style.pointerEvents = 'none';
  const labels = [];
  // Hidden labels still participate in collision placement, but need no DOM
  // position writes on each fractional zoom. Let exit fades finish first.
  const LabelMarker = L.Marker.extend({
    update() {
      if (this.layoutVisible || performance.now() < (this.fadeUntil || 0)) L.Marker.prototype.update.call(this);
      return this;
    },
    setLayoutVisible(visible) {
      if (visible === Boolean(this.layoutVisible)) return;
      if (!visible) this.fadeUntil = performance.now() + 180;
      this.layoutVisible = visible;
      if (visible) this.update();
      this.getElement().classList.toggle('label-visible', visible);
    }
  });
  map.on('resize', () => labels.forEach(label => { delete label.size; }));

  function add(name, coords, kind, rank = 0, bounds = null) {
    const marker = new LabelMarker(coords, {
      pane: 'backgroundLabels', interactive: false, keyboard: false,
      icon: L.divIcon({className: `background-label background-${kind}-label`, html: '<span></span>', iconSize: [0, 0]})
    }).addTo(map);
    marker.getElement().firstChild.textContent = name;
    const extent = bounds ? bounds.getNorthEast().distanceTo(bounds.getSouthWest()) : 0;
    labels.push({marker, name, kind, rank, bounds, extent});
  }

  function geography(features, kind) {
    features.forEach(feature => {
      if (['010', '250-overseas'].includes(feature.id)) return;
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const area = ring => Math.abs(ring.reduce((sum, point, i) => {
        const next = ring[(i + 1) % ring.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0));
      const ring = polygons.map(polygon => polygon[0]).sort((a, b) => area(b) - area(a))[0];
      if (!ring?.length) return;
      const bounds = L.latLngBounds(ring.map(([lon, lat]) => [lat, lon]));
      add(feature.properties.name, bounds.getCenter(), kind, 0, bounds);
    });
  }

  function layout(occupied, visitedNames) {
    const zoom = map.getZoom(), bounds = map.getBounds(), root = map.getContainer().getBoundingClientRect();
    const size = map.getSize();
    labels.forEach(label => {
      if (!label.size) { const node = label.marker.getElement().firstChild; label.size = {width: node.offsetWidth, height: node.offsetHeight}; }
    });
    const ordered = [...labels].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'country' ? -1 : b.kind === 'country' ? 1 : a.kind === 'state' ? -1 : 1;
      if (a.bounds && b.bounds) return b.extent - a.extent;
      return a.rank - b.rank || Number(Boolean(b.visible)) - Number(Boolean(a.visible));
    });
    ordered.forEach(item => {
      const {marker, name, kind, rank, bounds: featureBounds} = item;
      const retained = Boolean(item.visible), slack = retained ? .15 : -.1;
      const show = visible => { item.visible = visible; marker.setLayoutVisible(visible); };
      if (!bounds.contains(marker.getLatLng()) || map.isLocationVisible && !map.isLocationVisible(marker.getLatLng()) || visitedNames.has(name.toLocaleLowerCase())) { show(false); return; }
      if (kind === 'country' && zoom > 7 + slack || kind === 'state' && (zoom < 4.5 - slack || zoom > 8 + slack) || kind === 'city' && zoom < 5 + rank * .6 - slack) { show(false); return; }
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const rect = {left: root.left + point.x - item.size.width / 2, right: root.left + point.x + item.size.width / 2,
        top: root.top + point.y - item.size.height / 2, bottom: root.top + point.y + item.size.height / 2, ...item.size};
      if (featureBounds) {
        const left = map.latLngToContainerPoint(featureBounds.getSouthWest());
        const right = map.latLngToContainerPoint(featureBounds.getNorthEast());
        if (Math.abs(right.x - left.x) < rect.width + (retained ? 10 : 18) || Math.abs(right.y - left.y) < rect.height + (retained ? 6 : 10)) { show(false); return; }
      }
      if (rect.left < root.left + 8 || rect.right > root.left + size.x - 8 || rect.top < root.top + 8 || rect.bottom > root.top + size.y - 30) { show(false); return; }
      const gap = retained ? 4 : 8;
      if (occupied.some(other => rect.left < other.right + gap && rect.right + gap > other.left && rect.top < other.bottom + gap && rect.bottom + gap > other.top)) { show(false); return; }
      occupied.push(rect);
      show(true);
    });
  }

  return {geography, cities: cities => cities.forEach(city => add(city.name, city.coords, 'city', city.rank)), layout};
}
