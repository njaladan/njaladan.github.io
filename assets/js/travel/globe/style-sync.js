// Mirrors the application's Leaflet panes, polygons and tile layers into the
// MapLibre style. One geography source shares tile parsing and globe clipping
// meshes; panes remain separate styled layers, just as in the shared app.
const base = window.L;
const SOURCE = 'atlas-geography';
const DEFAULT_PANE_Z = 400;
// Lines sort just above fills from the same pane.
const LINE_RANK = 0.1;
// Leaflet's polygon defaults, and the atlas's land colours.
const DEFAULT_FILL_OPACITY = 0.2;
const DEFAULT_FILL = '#fafafa';
const DEFAULT_STROKE = '#d9dde0';
const TILE_SIZE = 256;
const TILE_MAX_ZOOM = 16;

/** Paint for each geography layer type, given its opacity expression. */
const GEOGRAPHY_LAYERS = {
  fill: {
    opacityProperty: 'fill-opacity',
    opacityField: 'fillOpacity',
    paint: alpha => ({ 'fill-color': ['get', 'fill'], 'fill-opacity': alpha })
  },
  line: {
    opacityProperty: 'line-opacity',
    opacityField: 'opacity',
    paint: alpha => ({
      'line-color': ['get', 'color'],
      'line-width': ['get', 'width'],
      'line-opacity': alpha
    })
  }
};

/**
 * @typedef {{ id: string, rank: number }} Ranked
 */

/**
 * @param {HTMLElement} pane
 * @returns {number}
 */
const paneOpacity = pane => (pane.hidden ? 0 : Number(pane.style.opacity || 1));

/**
 * @param {HTMLElement} pane
 * @returns {number}
 */
const paneRank = pane => Number(pane.style.zIndex || DEFAULT_PANE_Z);

/**
 * Which geography layer types each pane needs.
 * @param {Set<any>} polygons
 * @returns {Map<string, { fill: boolean, line: boolean }>}
 */
function paneTypes(polygons) {
  const panes = new Map();
  polygons.forEach(layer => {
    const name = layer.options.pane || 'overlayPane';
    const types = panes.get(name) || { fill: false, line: false };
    types.fill ||=
      layer.options.fill !== false && (layer.options.fillOpacity ?? DEFAULT_FILL_OPACITY) > 0;
    types.line ||= layer.options.stroke !== false && (layer.options.weight || 0) > 0;
    panes.set(name, types);
  });
  return panes;
}

/**
 * A polygon layer as a GeoJSON feature carrying its pane and style.
 * @param {any} layer
 */
const geographyFeature = layer => ({
  ...layer.feature,
  id: base.Util.stamp(layer),
  properties: {
    ...layer.feature.properties,
    atlasPane: layer.options.pane || 'overlayPane',
    fill: layer.options.fillColor || layer.options.color || DEFAULT_FILL,
    fillOpacity:
      layer.options.fill === false ? 0 : (layer.options.fillOpacity ?? DEFAULT_FILL_OPACITY),
    color: layer.options.color || DEFAULT_STROKE,
    width: layer.options.stroke === false ? 0 : layer.options.weight || 0,
    opacity: layer.options.opacity ?? 1
  }
});

/**
 * Rebuilds the shared geography source after polygons change.
 * @param {any} globe
 */
function syncGeographyData(globe) {
  const map = globe.nativeMap;
  if (!globe._dirtyData && map.getSource(SOURCE)) return;
  const data = { type: 'FeatureCollection', features: [...globe._polygons].map(geographyFeature) };
  if (map.getSource(SOURCE)) map.getSource(SOURCE).setData(data);
  else map.addSource(SOURCE, { type: 'geojson', data });
}

/**
 * Adds or restyles one pane's fill and line layers to follow its opacity.
 * @param {any} globe
 * @param {string} name
 * @param {{ fill: boolean, line: boolean }} types
 * @param {Ranked[]} order receives the layers in this pane
 */
function syncPane(globe, name, types, order) {
  const map = globe.nativeMap,
    pane = globe.getPane(name),
    opacity = paneOpacity(pane);
  const state = `${opacity}/${types.fill}/${types.line}`,
    changed = globe._paneStyles.get(name) !== state;
  for (const type of ['fill', 'line']) {
    const spec = GEOGRAPHY_LAYERS[type],
      id = `${SOURCE}-${name}-${type}`,
      visible = opacity > 0 && types[type] ? 'visible' : 'none',
      alpha = ['*', ['get', spec.opacityField], opacity];
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type,
        source: SOURCE,
        filter: ['==', ['get', 'atlasPane'], name],
        layout: { visibility: visible },
        paint: spec.paint(alpha)
      });
    } else if (changed) {
      map.setLayoutProperty(id, 'visibility', visible);
      map.setPaintProperty(id, spec.opacityProperty, alpha);
    }
    order.push({ id, rank: paneRank(pane) + (type === 'line' ? LINE_RANK : 0) });
  }
  globe._paneStyles.set(name, state);
}

/**
 * Adds a greyscale raster source and layer for a Leaflet tile layer.
 * @param {any} globe
 * @param {any} tile
 * @returns {string} the layer and source id
 */
function addTileLayer(globe, tile) {
  const id = `atlas-tiles-${base.Util.stamp(tile)}`;
  globe._tileLayers.set(tile, id);
  globe.nativeMap.addSource(id, {
    type: 'raster',
    tiles: [tile._url],
    tileSize: TILE_SIZE,
    maxzoom: tile.options.maxNativeZoom || TILE_MAX_ZOOM,
    attribution: tile.options.attribution || ''
  });
  globe.nativeMap.addLayer({
    id,
    type: 'raster',
    source: id,
    // Leaflet zooms are one above MapLibre's.
    minzoom: Math.max(0, (tile.options.minZoom || 1) - 1),
    paint: { 'raster-saturation': -1 }
  });
  return id;
}

/**
 * Shows current tile layers at their pane's opacity and hides removed ones.
 * @param {any} globe
 * @param {Ranked[]} order receives the current tile layers
 */
function syncTiles(globe, order) {
  const map = globe.nativeMap;
  globe._tiles.forEach(tile => {
    const id = globe._tileLayers.get(tile) || addTileLayer(globe, tile);
    const pane = globe.getPane(tile.options.pane || 'overlayPane'),
      opacity = paneOpacity(pane);
    if (globe._tileStyles.get(id) !== opacity) {
      map.setLayoutProperty(id, 'visibility', opacity > 0 ? 'visible' : 'none');
      map.setPaintProperty(id, 'raster-opacity', opacity);
      globe._tileStyles.set(id, opacity);
    }
    order.push({ id, rank: paneRank(pane) });
  });
  globe._tileLayers.forEach((id, tile) => {
    if (!globe._tiles.has(tile) && globe._tileStyles.get(id) !== null) {
      map.setLayoutProperty(id, 'visibility', 'none');
      globe._tileStyles.set(id, null);
    }
  });
}

/**
 * Stacks layers by pane z-index, below the raised flights.
 * @param {any} globe
 * @param {Ranked[]} order
 */
function applyOrder(globe, order) {
  order.sort((a, b) => a.rank - b.rank);
  const ordering = order.map(layer => layer.id).join('/');
  if (ordering === globe._layerOrdering) return;
  order.forEach(({ id }) =>
    globe.nativeMap.moveLayer(id, globe._flightLayer ? globe._flightLayer.id : undefined)
  );
  globe._layerOrdering = ordering;
}

/**
 * Brings the MapLibre style in line with the globe's panes and layers.
 * @param {any} globe the GlobeMap
 */
export function syncStyle(globe) {
  const order = [];
  const panes = paneTypes(globe._polygons);
  syncGeographyData(globe);
  globe._paneStyles ||= new Map();
  panes.forEach((types, name) => syncPane(globe, name, types, order));
  globe._tileLayers ||= new Map();
  globe._tileStyles ||= new Map();
  syncTiles(globe, order);
  applyOrder(globe, order);
  globe._dirtyData = false;
}
