import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  printCurves,
  printSlot,
  printTiming
} from '../../../assets/js/travel/photos/print-motion.js';

test('print motion curves start at rest and land in place', () => {
  assert.deepEqual(printSlot(0), { x: 0, y: 0, angle: 0 });
  assert.deepEqual(printSlot(5), printSlot(2));
  assert.deepEqual(printCurves(0, false), { release: 0, travel: 0, pop: -0 });
  const end = printCurves(1, false);
  assert.equal(end.travel, 1);
  assert.ok(Math.abs(end.pop) < 1e-12);
  assert.deepEqual(printTiming({ index: 0, merging: true, moving: false }).delay, 64);
  assert.deepEqual(printTiming({ index: 0, merging: false, moving: false }).delay, 0);
});
