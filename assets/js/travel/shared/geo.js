// Geometry on [lat, lng] coordinate lists. Side-effect free, so the unit tests
// import it directly.

const EARTH_DIAMETER_KM = 12742;
const RADIANS = Math.PI / 180;
// Long tracks are sampled down to about this many points for proximity scans.
const PROXIMITY_SAMPLES = 400;

/**
 * Great-circle distance in kilometres.
 * @param {number[]} a [lat, lng]
 * @param {number[]} b [lat, lng]
 * @returns {number}
 */
export function haversine(a, b) {
  const h =
    Math.sin(((b[0] - a[0]) * RADIANS) / 2) ** 2 +
    Math.cos(a[0] * RADIANS) *
      Math.cos(b[0] * RADIANS) *
      Math.sin(((b[1] - a[1]) * RADIANS) / 2) ** 2;
  return EARTH_DIAMETER_KM * Math.asin(Math.sqrt(h));
}

/**
 * Length of a path in kilometres.
 * @param {number[][]} coords
 * @returns {number}
 */
export function pathKm(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Point halfway along a path by (planar) distance, where its badge sits.
 * @param {number[][]} coords
 * @returns {number[]}
 */
export function midpoint(coords) {
  const travelled = [0];
  for (let i = 1; i < coords.length; i++) {
    const step = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    travelled.push(travelled[i - 1] + step);
  }
  const half = travelled[travelled.length - 1] / 2;
  return coords[
    Math.max(
      0,
      travelled.findIndex(value => value >= half)
    )
  ];
}

/**
 * Index step that samples a long track down to about PROXIMITY_SAMPLES points.
 * @param {number} length
 * @returns {number}
 */
export const sampleStep = length => Math.max(1, Math.floor(length / PROXIMITY_SAMPLES));

/**
 * Smallest distance in kilometres from `coords` to a sampled set of points.
 * @param {number[]} coords
 * @param {number[][]} points
 * @returns {number}
 */
export function nearestKm(coords, points) {
  let best = Infinity;
  const step = sampleStep(points.length);
  for (let i = 0; i < points.length; i += step) {
    best = Math.min(best, haversine(coords, points[i]));
  }
  return best;
}

/**
 * Photos within `radiusKm` of any sampled point of a track.
 * @template {{coords: number[]}} T
 * @param {T[]} photos
 * @param {number[][]} coords
 * @param {number} radiusKm
 * @returns {T[]}
 */
export function photosNear(photos, coords, radiusKm) {
  const step = sampleStep(coords.length);
  return photos.filter(photo => {
    for (let i = 0; i < coords.length; i += step) {
      if (haversine(photo.coords, coords[i]) < radiusKm) return true;
    }
    return false;
  });
}

/**
 * Planar area (doubled, unsigned) of a [lng, lat] ring.
 * @param {number[][]} ring
 * @returns {number}
 */
export function ringArea(ring) {
  return Math.abs(
    ring.reduce((sum, point, i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0)
  );
}

/**
 * Outer ring of a GeoJSON Polygon or MultiPolygon's largest part.
 * @param {{type: string, coordinates: any[]}} geometry
 * @returns {number[][] | undefined}
 */
export function largestRing(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(polygon => polygon[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
}
