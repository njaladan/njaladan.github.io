function installBasemapLabels(map) {
  map.createPane('backgroundLabels');
  map.getPane('backgroundLabels').style.zIndex = 390;
  map.getPane('backgroundLabels').style.pointerEvents = 'none';
  const labels = [];

  function add(name, coords, kind, rank = 0, bounds = null) {
    const marker = L.marker(coords, {
      pane: 'backgroundLabels', interactive: false, keyboard: false,
      icon: L.divIcon({className: `background-label background-${kind}-label`, html: '<span></span>', iconSize: [0, 0]})
    }).addTo(map);
    marker.getElement().firstChild.textContent = name;
    labels.push({marker, name, kind, rank, bounds});
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
    const ordered = [...labels].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'country' ? -1 : b.kind === 'country' ? 1 : a.kind === 'state' ? -1 : 1;
      if (a.bounds && b.bounds) return b.bounds.getNorthEast().distanceTo(b.bounds.getSouthWest()) - a.bounds.getNorthEast().distanceTo(a.bounds.getSouthWest());
      return a.rank - b.rank;
    });
    ordered.forEach(({marker, name, kind, rank, bounds: featureBounds}) => {
      const node = marker.getElement();
      node.style.visibility = 'hidden';
      if (!bounds.contains(marker.getLatLng()) || visitedNames.has(name.toLocaleLowerCase())) return;
      if (kind === 'country' && zoom > 7 || kind === 'state' && (zoom < 4.5 || zoom > 8) || kind === 'city' && zoom < 5 + rank * .6) return;
      const rect = node.firstChild.getBoundingClientRect();
      if (featureBounds) {
        const left = map.latLngToContainerPoint(featureBounds.getSouthWest());
        const right = map.latLngToContainerPoint(featureBounds.getNorthEast());
        if (Math.abs(right.x - left.x) < rect.width + 18 || Math.abs(right.y - left.y) < rect.height + 10) return;
      }
      if (rect.left < root.left + 8 || rect.right > root.left + size.x - 8 || rect.top < root.top + 8 || rect.bottom > root.top + size.y - 30) return;
      if (occupied.some(other => rect.left < other.right + 8 && rect.right + 8 > other.left && rect.top < other.bottom + 6 && rect.bottom + 6 > other.top)) return;
      occupied.push(rect);
      node.style.visibility = 'visible';
    });
  }

  return {geography, cities: cities => cities.forEach(city => add(city.name, city.coords, 'city', city.rank)), layout};
}
