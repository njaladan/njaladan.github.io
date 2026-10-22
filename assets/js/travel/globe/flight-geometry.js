// Pure geometry for the elevated flight ribbons: great-circle arcs, vertex
// buffers, screen projection for hit testing and style batching. Mercator
// conversion is passed in, so this module loads without MapLibre.

/** Mean Earth radius in metres, as MapLibre uses. */
export const EARTH_RADIUS = 6371008.8;
/** Floats per ribbon vertex: position, other end, then scale, side and distance. */
export const VERTEX_FLOATS = 9;
/** Above this MapLibre zoom the raised arcs are gone and flat lines take over. */
export const FLIGHT_MAX_ZOOM = 6;
// Raised arcs fade out, and flat lines fade in, across this many zoom levels.
const FLIGHT_FADE_ZOOMS = 1.5;
const ARC_SEGMENTS = 96;
// Illustrative arc heights: a share of the route's length, within limits.
const ARC_HEIGHT_SHARE = 0.16;
const MIN_ARC_HEIGHT = 80000;
const MAX_ARC_HEIGHT = 1500000;
// The depth-only sphere is a grid of this many degrees, sunk below the surface.
const SPHERE_STEP = 3;
const SPHERE_DEPTH = 1000;
const MAX_MERCATOR_LAT = 89.999;
/** Pointer distance, in pixels, within which an arc counts as hovered. */
export const PICK_DISTANCE = 9;

/**
 * @typedef {{ x: number, y: number, meterInMercatorCoordinateUnits(): number }} Mercator
 * @typedef {(lngLat: number[]) => Mercator} ToMercator
 * @typedef {{ x: number, y: number, height: number, scale: number, along: number,
 *   t: number, coords: number[] }} ArcPoint
 * @typedef {{ index: number, route: any, points: ArcPoint[], height: number }} RouteArc
 * @typedef {{ index: number, first: number, count: number }} Range
 * @typedef {{ color: string, weight: number, opacity: number }} ArcStyle
 * @typedef {Range & { style: ArcStyle }} Batch
 * @typedef {{ projectionTransition: number, clippingPlane: number[], mainMatrix: number[],
 *   fallbackMatrix: number[] }} ProjectionData
 */

/**
 * Unit vector for a [lat, lon] position in degrees.
 * @param {number[]} coords
 * @returns {number[]}
 */
export function unitVector([latDegrees, lonDegrees]) {
  const lat = (latDegrees * Math.PI) / 180,
    lon = (lonDegrees * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/**
 * Central angle between two unit vectors, in radians.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export const centralAngle = (a, b) =>
  Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        a.reduce((sum, value, i) => sum + value * b[i], 0)
      )
    )
  );

/**
 * Peak height of an arc spanning `angle` radians, in metres.
 * @param {number} angle
 * @returns {number}
 */
export const arcHeight = angle =>
  Math.min(MAX_ARC_HEIGHT, Math.max(MIN_ARC_HEIGHT, angle * EARTH_RADIUS * ARC_HEIGHT_SHARE));

/**
 * Samples the raised great circle between two [lat, lon] positions.
 * @param {number[]} from
 * @param {number[]} to
 * @param {ToMercator} toMercator
 * @returns {{ points: ArcPoint[], height: number }}
 */
export function arcPoints(from, to, toMercator) {
  const a = unitVector(from),
    b = unitVector(to),
    angle = centralAngle(a, b),
    height = arcHeight(angle);
  const points = Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
    const t = i / ARC_SEGMENTS,
      sine = Math.sin(angle);
    const v =
      Math.abs(sine) < 1e-6
        ? a
        : a.map(
            (value, j) => (Math.sin((1 - t) * angle) * value + Math.sin(t * angle) * b[j]) / sine
          );
    const lat = (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI,
      lon = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
    const mercator = toMercator([lon, lat]);
    return {
      x: mercator.x,
      y: mercator.y,
      height: Math.sin(Math.PI * t) * height,
      scale: mercator.meterInMercatorCoordinateUnits(),
      along: (t * angle * EARTH_RADIUS) / 1000,
      t,
      coords: [lon, lat]
    };
  });
  return { points, height };
}

/**
 * One arc per logged route whose endpoints are both known airports.
 * @param {{ routes: any[], flights: any, airports: any }} log
 * @param {ToMercator} toMercator
 * @returns {RouteArc[]}
 */
export function routeArcs(log, toMercator) {
  return log.routes
    .map((route, index) => {
      const flight = log.flights[route.flights[0]],
        from = log.airports[flight?.from || route.airports[0]],
        to = log.airports[flight?.to || route.airports[1]];
      if (!from || !to) return null;
      return { index, route, ...arcPoints(from.coords, to.coords, toMercator) };
    })
    .filter(Boolean);
}

/**
 * Two triangles per arc segment. Each vertex knows the segment's other end so
 * the shader can widen the ribbon in screen space. The side's magnitude
 * carries progress along the arc (1 at departure, 2 at arrival).
 * @param {RouteArc[]} routes
 * @returns {{ floats: number[], ranges: Range[] }}
 */
export function ribbonVertices(routes) {
  const floats = [],
    ranges = [];
  const vertex = (point, other, side) =>
    floats.push(
      point.x,
      point.y,
      point.height,
      other.x,
      other.y,
      other.height,
      point.scale,
      side * (1 + point.t),
      point.along
    );
  routes.forEach(({ points, index }) => {
    const first = floats.length / VERTEX_FLOATS;
    points.slice(1).forEach((b, i) => {
      const a = points[i];
      // Keep adjacent longitudes continuous when a connection crosses the dateline.
      let bx = b.x;
      while (bx - a.x > 0.5) bx -= 1;
      while (bx - a.x < -0.5) bx += 1;
      const next = { ...b, x: bx };
      [
        [a, next, -1],
        [next, a, 1],
        [a, next, 1],
        [a, next, 1],
        [next, a, 1],
        [next, a, -1]
      ].forEach(([p, other, side]) => vertex(p, other, side));
    });
    ranges.push({ index, first, count: floats.length / VERTEX_FLOATS - first });
  });
  return { floats, ranges };
}

/**
 * A depth-only sphere just below the surface, so arcs behind the Earth are
 * hidden by the depth test.
 * @param {ToMercator} toMercator
 * @returns {number[]}
 */
export function sphereVertices(toMercator) {
  const floats = [];
  const surfaceVertex = (lon, lat) => {
    const p = toMercator([lon, Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))]);
    floats.push(p.x, p.y, -SPHERE_DEPTH, p.x, p.y, 0, p.meterInMercatorCoordinateUnits(), 0, 0);
  };
  for (let lat = -90; lat < 90; lat += SPHERE_STEP) {
    for (let lon = -180; lon < 180; lon += SPHERE_STEP) {
      const east = lon + SPHERE_STEP,
        north = lat + SPHERE_STEP;
      surfaceVertex(lon, lat);
      surfaceVertex(east, lat);
      surfaceVertex(lon, north);
      surfaceVertex(lon, north);
      surfaceVertex(east, lat);
      surfaceVertex(east, north);
    }
  }
  return floats;
}

/**
 * Applies a column-major 4x4 matrix to a 3D point.
 * @param {ArrayLike<number>} matrix
 * @param {number[]} p
 * @returns {number[]}
 */
const transform = (matrix, p) =>
  [0, 1, 2, 3].map(
    i => matrix[i] * p[0] + matrix[i + 4] * p[1] + matrix[i + 8] * p[2] + matrix[i + 12]
  );

/**
 * Projects an arc point to container pixels the way the shader does, or null
 * when it is behind the globe or the camera.
 * @param {ArcPoint} point
 * @param {ProjectionData} data
 * @param {{ width: number, height: number }} size
 * @returns {{ x: number, y: number } | null}
 */
export function projectArcPoint(point, data, size) {
  const t = data.projectionTransition,
    lambda = point.x * 2 * Math.PI + Math.PI,
    phi = (point.coords[1] * Math.PI) / 180;
  const height = point.height * t * t;
  const r = 1 + height / EARTH_RADIUS,
    onSphere = [
      Math.sin(lambda) * Math.cos(phi) * r,
      Math.sin(phi) * r,
      Math.cos(lambda) * Math.cos(phi) * r
    ];
  const clip = data.clippingPlane;
  if (t > 0.8 && onSphere.reduce((sum, value, i) => sum + value * clip[i], clip[3]) < 0) {
    return null;
  }
  const globe = transform(data.mainMatrix, onSphere),
    flat = transform(data.fallbackMatrix, [point.x, point.y, height * point.scale]);
  const p = globe.map((value, i) => flat[i] * (1 - t) + value * t);
  if (p[3] <= 0) return null;
  return {
    x: ((p[0] / p[3] + 1) * size.width) / 2,
    y: ((1 - p[1] / p[3]) * size.height) / 2
  };
}

/**
 * Distance from `p` to the segment from `a` to `b`.
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * The route whose projected arc passes closest to `cursor`, within reach.
 * @template T
 * @param {{ route: T, points: ({ x: number, y: number } | null)[] }[]} projected
 * @param {{ x: number, y: number }} cursor
 * @returns {T | null}
 */
export function nearestArc(projected, cursor) {
  let nearest = null,
    distance = PICK_DISTANCE;
  projected.forEach(({ route, points }) =>
    points.slice(1).forEach((b, i) => {
      const a = points[i];
      if (!a || !b) return;
      const d = segmentDistance(cursor, a, b);
      if (d < distance) {
        nearest = route;
        distance = d;
      }
    })
  );
  return nearest;
}

/**
 * Merges adjacent ranges that share a style, so each frame needs one draw
 * per run of identical routes rather than one per flight. Unstyled routes
 * are not drawn.
 * @param {Range[]} ranges
 * @param {Map<number, ArcStyle>} styles
 * @returns {Batch[]}
 */
export function styleBatches(ranges, styles) {
  return ranges.reduce((groups, range) => {
    const style = styles.get(range.index);
    if (!style) return groups;
    const previous = groups.at(-1);
    if (
      previous &&
      previous.first + previous.count === range.first &&
      ['color', 'weight', 'opacity'].every(key => previous.style[key] === style[key])
    ) {
      previous.count += range.count;
    } else {
      groups.push({ ...range, style });
    }
    return groups;
  }, []);
}

/**
 * RGB channels in [0, 1] for a `#rrggbb` color.
 * @param {string} color
 * @returns {number[]}
 */
export const rgb = color =>
  [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255);

/**
 * Opacity of the raised arcs at a MapLibre zoom: they fade out toward the
 * zoom where flat lines take over.
 * @param {number} zoom
 * @returns {number}
 */
export const arcFade = zoom => Math.min(1, (FLIGHT_MAX_ZOOM - zoom) / FLIGHT_FADE_ZOOMS);

/**
 * Opacity of the flat flight lines at a MapLibre zoom, the inverse of arcFade.
 * @param {number} zoom
 * @returns {number}
 */
export const lineFade = zoom =>
  Math.max(0, Math.min(1, (zoom - (FLIGHT_MAX_ZOOM - FLIGHT_FADE_ZOOMS)) / FLIGHT_FADE_ZOOMS));
