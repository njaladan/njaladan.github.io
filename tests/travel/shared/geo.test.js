import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  haversine,
  largestRing,
  midpoint,
  nearestKm,
  pathKm,
  photosNear,
  ringArea
} from '../../../assets/js/travel/shared/geo.js';

test('haversine measures great-circle kilometres', () => {
  assert.equal(haversine([0, 0], [0, 0]), 0);
  // One degree of longitude at the equator is about 111.2 km.
  assert.ok(Math.abs(haversine([0, 0], [0, 1]) - 111.19) < 0.05);
});

test('pathKm sums segments and midpoint finds the halfway vertex', () => {
  const path = [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3]
  ];
  assert.ok(Math.abs(pathKm(path) - 3 * haversine([0, 0], [0, 1])) < 1e-9);
  assert.deepEqual(midpoint(path), [0, 2]);
  assert.deepEqual(midpoint([[5, 5]]), [5, 5]);
});

test('photosNear and nearestKm scan the track', () => {
  const track = [
    [10, 10],
    [10, 11]
  ];
  const photos = [{ coords: [10, 11.001] }, { coords: [20, 20] }];
  assert.deepEqual(photosNear(photos, track, 1), [photos[0]]);
  assert.ok(nearestKm([10, 10], track) === 0);
  assert.equal(nearestKm([0, 0], []), Infinity);
});

test('largestRing picks the biggest polygon part', () => {
  const small = [
    [0, 0],
    [1, 0],
    [1, 1]
  ];
  const big = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4]
  ];
  assert.equal(ringArea(big), 32);
  assert.equal(largestRing({ type: 'Polygon', coordinates: [small] }), small);
  assert.equal(largestRing({ type: 'MultiPolygon', coordinates: [[small], [big]] }), big);
});
