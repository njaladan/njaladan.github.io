import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  airportCodeRect,
  inside,
  labelRect,
  nearestPlace,
  overflowShift,
  overlaps,
  parseViewParams,
  ramp,
  scopeFrance,
  splitAtGaps,
  splitDateline,
  tooltipShift
} from '../../assets/js/travel/atlas/geometry.js';

const flat = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const LIMITS = { zoom: 13, minZoom: 1, maxZoom: 17 };

test('ramp clamps to 0–1', () => {
  assert.equal(ramp(2, 3, 1.5), 0);
  assert.equal(ramp(3.75, 3, 1.5), 0.5);
  assert.equal(ramp(9, 3, 1.5), 1);
});

test('splitAtGaps breaks tracks at jumps and drops single points', () => {
  const track = [
    [0, 0],
    [0, 1],
    [0, 5],
    [0, 9],
    [0, 10]
  ];
  assert.deepEqual(splitAtGaps(track, flat, 2), [
    [
      [0, 0],
      [0, 1]
    ],
    [
      [0, 9],
      [0, 10]
    ]
  ]);
  assert.deepEqual(splitAtGaps([], flat, 2), []);
});

test('nearestPlace respects the distance limit', () => {
  const places = [{ coords: [0, 0] }, { coords: [0, 10] }];
  assert.equal(nearestPlace([0, 8], places, flat, 5), places[1]);
  assert.equal(nearestPlace([50, 50], places, flat, 5), null);
  assert.equal(nearestPlace([0, 0], [], flat, 5), null);
});

test('overflowShift reveals only what overflows', () => {
  const margins = { near: 70, far: 20 };
  assert.equal(overflowShift(100, 50, 500, margins), 0);
  assert.equal(overflowShift(460, 50, 500, margins), 30);
  assert.equal(overflowShift(30, 50, 500, margins), -40);
});

test('rectangle tests honour the gap', () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(overlaps(a, { left: 12, top: 0, right: 20, bottom: 10 }, 3), true);
  assert.equal(overlaps(a, { left: 14, top: 0, right: 20, bottom: 10 }, 3), false);
  assert.equal(inside(a, { left: 0, top: 0, right: 10, bottom: 10 }), true);
  assert.equal(inside(a, { left: 1, top: 0, right: 10, bottom: 10 }), false);
});

test('labels extend from the anchor in their direction', () => {
  const size = { width: 41, height: 15 },
    origin = { x: 100, y: 100 },
    anchor = { x: 0, y: 0 };
  assert.deepEqual(labelRect({ origin, anchor, direction: 'right', size }), {
    left: 114,
    top: 92,
    right: 155,
    bottom: 107
  });
  assert.deepEqual(labelRect({ origin, anchor, direction: 'left', size }), {
    left: 45,
    top: 92,
    right: 86,
    bottom: 107
  });
  assert.deepEqual(labelRect({ origin, anchor, direction: 'top', size }), {
    left: 79,
    top: 73,
    right: 120,
    bottom: 88
  });
  assert.deepEqual(tooltipShift(size, 'left'), { x: 41, y: 7.5 });
  assert.deepEqual(tooltipShift(size, 'bottom'), { x: 20.5, y: 0 });
  assert.deepEqual(airportCodeRect(origin, true), { left: 42, right: 82, top: 89, bottom: 111 });
});

test('deep links need valid coordinates and clamp the zoom', () => {
  assert.deepEqual(parseViewParams('?lat=45.5&lng=-73.5', LIMITS), {
    lat: 45.5,
    lng: -73.5,
    zoom: 13
  });
  assert.deepEqual(parseViewParams('?lat=1&lng=2&zoom=40', LIMITS), { lat: 1, lng: 2, zoom: 17 });
  assert.equal(parseViewParams('?lat=1', LIMITS), null);
  assert.equal(parseViewParams('?lat=95&lng=0', LIMITS), null);
  assert.equal(parseViewParams('?lat=x&lng=0', LIMITS), null);
});

test('splitDateline cuts a crossing polygon into world copies', () => {
  const ring = [
    [170, 0],
    [-170, 0],
    [-170, 10],
    [170, 10],
    [170, 0]
  ];
  const feature = { id: 242, geometry: { type: 'Polygon', coordinates: [ring] } };
  const { geometry } = splitDateline(feature);
  assert.equal(geometry.type, 'MultiPolygon');
  assert.equal(geometry.coordinates.length, 2);
  geometry.coordinates.forEach(([outer]) =>
    outer.forEach(([lon]) => assert.ok(lon >= -180 && lon <= 180))
  );
  const other = { id: 1, geometry: feature.geometry };
  assert.equal(splitDateline(other), other);
});

test('scopeFrance separates overseas regions', () => {
  const paris = [
      [
        [2, 48],
        [3, 48],
        [3, 49],
        [2, 48]
      ]
    ],
    guiana = [
      [
        [-53, 4],
        [-52, 4],
        [-52, 5],
        [-53, 4]
      ]
    ];
  const [metropolitan, overseas] = scopeFrance({
    id: 250,
    geometry: { type: 'MultiPolygon', coordinates: [paris, guiana] }
  });
  assert.deepEqual(metropolitan.geometry.coordinates, [paris]);
  assert.equal(overseas.id, '250-overseas');
  assert.deepEqual(overseas.geometry.coordinates, [guiana]);
});
