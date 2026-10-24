import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeDeltas,
  ease,
  inOrderAt,
  measurePieces,
  percent,
  sliceTrack
} from '../../assets/js/athletics/coverage.js';

/** @type {(x: number, y: number) => [number, number]} */
const identity = (x, y) => [x, y];

test('decodeDeltas keeps the first pair and accumulates the rest', () => {
  assert.deepEqual(decodeDeltas([10, 20, 1, -2, 3, 0]), [10, 20, 11, 18, 14, 18]);
  assert.deepEqual(decodeDeltas([]), []);
});

test('measurePieces measures each piece and offsets it along the track', () => {
  const { pieces, length } = measurePieces(
    [
      [0, 0, 3, 4],
      [10, 0, 10, 5, 10, 10]
    ],
    identity
  );
  assert.equal(length, 15);
  assert.deepEqual(pieces[0].at, [0, 5]);
  assert.deepEqual(pieces[1].at, [0, 5, 10]);
  assert.equal(pieces[1].off, 5);
});

test('sliceTrack cuts exactly at both ends and skips pieces outside the range', () => {
  const { pieces } = measurePieces(
    [
      [0, 0, 10, 0],
      [0, 5, 10, 5]
    ],
    identity
  );
  assert.deepEqual(sliceTrack(pieces, 2, 7), [
    [
      [2, 0],
      [7, 0]
    ]
  ]);
  assert.deepEqual(sliceTrack(pieces, 12, 30), [
    [
      [2, 5],
      [10, 5]
    ]
  ]);
  assert.equal(sliceTrack(pieces, 8, 12).length, 2);
  assert.deepEqual(sliceTrack(pieces, 30, 40), []);
});

test('ease is clamped and symmetric', () => {
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  assert.ok(Math.abs(ease(0.5) - 0.5) < 1e-12);
});

test('inOrderAt interpolates within a year from the year before', () => {
  const dates = ['2022-03-01', '2023-01-01', '2023-06-01', '2023-12-01', '2024-02-02'];
  const years = { 2022: 2, 2023: 12, 2024: 20 };
  assert.deepEqual(inOrderAt(dates, years, 0), { year: '2022', pct: 2 });
  const mid = inOrderAt(dates, years, 0.5);
  assert.equal(mid.year, '2023');
  assert.ok(Math.abs(mid.pct - (2 + 10 * (2 / 3))) < 1e-9);
  assert.deepEqual(inOrderAt(dates, years, 1), { year: '2024', pct: 20 });
});

test('percent rounds to one decimal place', () => {
  assert.equal(percent(260.6, 834), 31.2);
  assert.equal(percent(1, 0), 0);
});
