import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peel, polygon, reachable } from '../../assets/js/library/peel.js';

const [W, H] = [300, 450];
const BOTTOM = { x: W, y: H };

/** @param {{ x: number, y: number }[]} points */
const area = points =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0)
  ) / 2;

test('a corner at rest does not fold', () => {
  assert.equal(peel(W, H, BOTTOM, BOTTOM), null);
  assert.equal(polygon([]), 'inset(50%)');
});

test('pulling the corner straight across folds the page upright', () => {
  const result = peel(W, H, BOTTOM, { x: 100, y: H });
  // Fold at x = 200: the strip past it lifts, the rest stays flat.
  assert.equal(area(result.flat), 200 * H);
  assert.equal(area(result.lifted), 100 * H);
  assert.equal(
    result.reflect,
    'matrix(-1.000000, 0.000000, 0.000000, 1.000000, 400.000000, 0.000000)'
  );
  // The gradient runs from the fold toward the corner (rightward, 90deg), starting at x = 0.
  assert.equal(Math.round(result.angle), 90);
  assert.equal(Math.round(result.fold), 200);
});

test('pulling the corner up and in folds it on a slant', () => {
  const result = peel(W, H, BOTTOM, { x: 200, y: 350 });
  assert.equal(result.lifted.length, 3, 'only a triangle at the corner lifts');
  assert.equal(Math.round(area(result.flat) + area(result.lifted)), W * H);
});

test('a lifted corner stays within reach of the spine', () => {
  const pulled = reachable({ x: -500, y: H + 200 }, BOTTOM, H);
  assert.ok(Math.hypot(pulled.x, pulled.y - H) <= W + 1e-9);
  assert.ok(Math.hypot(pulled.x, pulled.y) <= Math.hypot(W, H) + 1e-9);
  assert.deepEqual(reachable({ x: 100, y: 400 }, BOTTOM, H), { x: 100, y: 400 });
  // Turned all the way over, the page lies flat on the far side.
  const over = peel(W, H, BOTTOM, reachable({ x: -W, y: H }, BOTTOM, H));
  assert.equal(area(over.flat), 0);
});
