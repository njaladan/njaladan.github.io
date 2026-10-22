import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EARTH_RADIUS,
  VERTEX_FLOATS,
  arcFade,
  arcHeight,
  arcPoints,
  centralAngle,
  lineFade,
  nearestArc,
  projectArcPoint,
  rgb,
  ribbonVertices,
  routeArcs,
  segmentDistance,
  sphereVertices,
  styleBatches,
  unitVector
} from '../../assets/js/travel/globe/flight-geometry.js';

// Web Mercator in MapLibre's 0..1 world units.
const toMercator = ([lon, lat]) => {
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return {
    x: (180 + lon) / 360,
    y,
    meterInMercatorCoordinateUnits: () =>
      1 / (2 * Math.PI * EARTH_RADIUS) / Math.cos((lat * Math.PI) / 180)
  };
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('unit vectors and central angles', () => {
  const [x, y, z] = unitVector([0, 90]);
  near(x, 0);
  near(y, 1);
  near(z, 0);
  near(centralAngle(unitVector([0, 0]), unitVector([0, 90])), Math.PI / 2);
  near(centralAngle(unitVector([10, 20]), unitVector([10, 20])), 0);
});

test('arc heights stay within limits', () => {
  assert.equal(arcHeight(0), 80000);
  assert.equal(arcHeight(Math.PI), 1500000);
  near(arcHeight(0.1), 0.1 * EARTH_RADIUS * 0.16);
});

test('arcPoints follow the great circle and rise mid-route', () => {
  const { points, height } = arcPoints([0, 0], [0, 90], toMercator);
  assert.equal(points.length, 97);
  near(points[0].coords[0], 0);
  near(points[96].coords[0], 90);
  near(points[48].coords[0], 45);
  near(points[48].height, height);
  near(points[0].height, 0);
  near(points[96].along, ((Math.PI / 2) * EARTH_RADIUS) / 1000, 1e-6);
});

test('routeArcs skips routes with unknown airports', () => {
  const log = {
    routes: [
      { flights: [0], airports: [] },
      { flights: [], airports: ['A', 'C'] },
      { flights: [], airports: ['A', 'X'] }
    ],
    flights: [{ from: 'A', to: 'B' }],
    airports: { A: { coords: [0, 0] }, B: { coords: [10, 10] }, C: { coords: [20, 0] } }
  };
  const arcs = routeArcs(log, toMercator);
  assert.deepEqual(
    arcs.map(arc => arc.index),
    [0, 1]
  );
  assert.equal(arcs[0].route, log.routes[0]);
});

test('ribbonVertices emits six vertices per segment, continuous over the dateline', () => {
  const arcs = [{ index: 3, route: {}, ...arcPoints([0, 170], [0, -170], toMercator) }];
  const { floats, ranges } = ribbonVertices(arcs);
  assert.deepEqual(ranges, [{ index: 3, first: 0, count: 96 * 6 }]);
  assert.equal(floats.length, 96 * 6 * VERTEX_FLOATS);
  for (let i = 0; i < floats.length; i += VERTEX_FLOATS) {
    assert.ok(Math.abs(floats[i] - floats[i + 3]) < 0.5);
  }
  // Side magnitude carries progress: 1 at departure, 2 at arrival.
  assert.equal(floats[7], -1);
  assert.equal(floats[floats.length - VERTEX_FLOATS + 7], -2);
});

test('sphereVertices covers the globe in 3° cells', () => {
  assert.equal(sphereVertices(toMercator).length, 60 * 120 * 6 * VERTEX_FLOATS);
});

test('projectArcPoint uses the flat matrix at transition 0', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const data = {
    projectionTransition: 0,
    clippingPlane: [0, 0, 0, 0],
    mainMatrix: identity,
    fallbackMatrix: identity
  };
  const point = { x: 0.5, y: -0.5, height: 0, scale: 1, along: 0, t: 0, coords: [0, 0] };
  assert.deepEqual(projectArcPoint(point, data, { width: 200, height: 100 }), { x: 150, y: 75 });
  const behind = [...identity];
  behind[15] = -1;
  assert.equal(
    projectArcPoint(point, { ...data, fallbackMatrix: behind }, { width: 1, height: 1 }),
    null
  );
});

test('nearestArc picks the closest route within reach', () => {
  near(segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  near(segmentDistance({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  const projected = [
    {
      route: 'a',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ]
    },
    { route: 'b', points: [{ x: 0, y: 4 }, null, { x: 10, y: 4 }] },
    {
      route: 'c',
      points: [
        { x: 0, y: 5 },
        { x: 10, y: 5 }
      ]
    }
  ];
  assert.equal(nearestArc(projected, { x: 5, y: 3 }), 'c');
  assert.equal(nearestArc(projected, { x: 5, y: 1 }), 'a');
  assert.equal(nearestArc(projected, { x: 5, y: 30 }), null);
});

test('styleBatches merges adjacent ranges with equal styles', () => {
  const ranges = [
    { index: 0, first: 0, count: 6 },
    { index: 1, first: 6, count: 6 },
    { index: 2, first: 12, count: 6 },
    { index: 3, first: 18, count: 6 }
  ];
  const a = { color: '#000000', weight: 1, opacity: 1 };
  const styles = new Map([
    [0, a],
    [1, { ...a }],
    [2, { ...a, weight: 2 }]
  ]);
  assert.deepEqual(
    styleBatches(ranges, styles).map(({ index, first, count }) => [index, first, count]),
    [
      [0, 0, 12],
      [2, 12, 6]
    ]
  );
});

test('colors and fades', () => {
  assert.deepEqual(rgb('#ff0080'), [1, 0, 128 / 255]);
  assert.equal(arcFade(3), 1);
  assert.equal(arcFade(5.25), 0.5);
  assert.equal(lineFade(3), 0);
  assert.equal(lineFade(5.25), 0.5);
  assert.equal(lineFade(7), 1);
});
