// Layer groups, raster tiles and GeoJSON for the globe renderer.
import { Polygon } from './vectors.js';

const base = window.L;

export const Group = base.LayerGroup.extend({
  setStyle(style) {
    this.eachLayer(layer =>
      layer.setStyle?.(typeof style === 'function' ? style(layer.feature) : style)
    );
    return this;
  }
});

// Raster tiles become MapLibre sources and layers in style-sync.js.
export const Tile = base.TileLayer.extend({
  onAdd(map) {
    map._tiles.add(this);
    map.queueStyle();
  },
  onRemove(map) {
    map._tiles.delete(this);
    map.queueStyle();
  }
});

/**
 * Features from a GeoJSON feature array, FeatureCollection or single feature.
 * @param {any} data
 * @returns {any[]}
 */
function featureList(data) {
  if (Array.isArray(data)) return data;
  if (data.type === 'FeatureCollection') return data.features;
  return [data];
}

/**
 * Leaflet's `L.geoJSON` for polygon data, one Polygon layer per feature.
 * @param {any} data
 * @param {{ style?: any, onEachFeature?: (feature: any, layer: any) => void }} [options]
 */
export function geoJSON(data, options = {}) {
  const group = new Group();
  featureList(data).forEach(feature => {
    const coordinates = base.GeoJSON.coordsToLatLngs(
      feature.geometry.coordinates,
      feature.geometry.type === 'MultiPolygon' ? 2 : 1
    );
    const layer = new Polygon(coordinates, {
      ...options,
      ...(typeof options.style === 'function' ? options.style(feature) : options.style)
    });
    layer.feature = feature;
    options.onEachFeature?.(feature, layer);
    group.addLayer(layer);
  });
  return group;
}
