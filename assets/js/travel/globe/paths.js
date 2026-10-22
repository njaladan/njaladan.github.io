// Projection of vector geometry onto the globe's SVG hit and outline layers.
import { linePath, ringPath } from './math.js';

const base = window.L;
// Simplify to within a pixel of a 512-pixel world tile at the next zoom level.
const WORLD_TILE = 512;
// Lines are clipped to the viewport plus this margin, so strokes reach the edge.
const CLIP_MARGIN = 80;

// Recorded routes hold thousands of GPS points each. Simplify them once per
// whole zoom level to within a pixel, rather than projecting every point
// on every camera frame. Outlines share their line's geometry and result.
const simplified = new WeakMap();

/**
 * @param {object} geometry cache key shared by layers drawing the same line
 * @param {any[][]} segments Leaflet LatLng arrays
 * @param {number} zoom MapLibre zoom
 * @returns {any[][]}
 */
export function simplify(geometry, segments, zoom) {
  const level = Math.max(0, Math.floor(zoom));
  let levels = simplified.get(geometry);
  if (!levels) {
    levels = new Map();
    simplified.set(geometry, levels);
  }
  if (!levels.has(level)) {
    const tolerance = 1 / (WORLD_TILE * 2 ** (level + 1));
    levels.set(
      level,
      segments.map(segment =>
        base.LineUtil.simplify(
          segment.map(coords => {
            const p = maplibregl.MercatorCoordinate.fromLngLat([coords.lng, coords.lat]),
              item = base.point(p.x, p.y);
            item.latlng = coords;
            return item;
          }),
          tolerance
        ).map(item => item.latlng)
      )
    );
  }
  return levels.get(level);
}

/**
 * Projects one segment to screen parts, breaking it where it passes behind
 * the globe or leaves the clip box.
 * @param {any} map the globe map
 * @param {any[]} segment
 * @param {any} clip Leaflet bounds
 * @param {any[][]} parts receives finished parts
 */
function projectSegment(map, segment, clip, parts) {
  let current = [],
    previous = null;
  segment.forEach(coords => {
    if (!map.isLocationVisible(coords)) {
      if (current.length > 1) parts.push(current);
      current = [];
      previous = null;
      return;
    }
    const projected = map.latLngToLayerPoint(coords);
    if (previous) {
      const pair = base.LineUtil.clipSegment(previous, projected, clip, false, true);
      if (pair) {
        if (!current.length) current.push(pair[0]);
        current.push(pair[1]);
      } else {
        if (current.length > 1) parts.push(current);
        current = [];
      }
    }
    previous = projected;
  });
  if (current.length > 1) parts.push(current);
}

/**
 * Visible, clipped screen parts of a polyline's segments.
 * @param {any} map the globe map
 * @param {any[][]} segments
 * @returns {{ parts: any[][], path: string }}
 */
export function projectLine(map, segments) {
  const size = map.getSize(),
    parts = [];
  const clip = base.bounds([
    [-CLIP_MARGIN, -CLIP_MARGIN],
    [size.x + CLIP_MARGIN, size.y + CLIP_MARGIN]
  ]);
  segments.forEach(segment => projectSegment(map, segment, clip, parts));
  return { parts, path: linePath(parts) };
}

/**
 * Path data for a GeoJSON Polygon or MultiPolygon's visible vertices.
 * @param {any} map the globe map
 * @param {{ type: string, coordinates: any[] }} geometry
 * @returns {string}
 */
export function projectPolygon(map, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .map(polygon =>
      polygon
        .map(ring =>
          ringPath(
            ring
              .map(([lon, lat]) =>
                map.isLocationVisible([lat, lon]) ? map.latLngToLayerPoint([lat, lon]) : null
              )
              .filter(Boolean)
          )
        )
        .join('')
    )
    .join('');
}
