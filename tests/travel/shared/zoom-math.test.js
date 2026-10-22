import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  anchoredOffset,
  constrainOffset,
  pinch,
  wheelUnit
} from '../../../assets/js/travel/shared/zoom-math.js';

test('zoom math', () => {
  assert.equal(wheelUnit(0, 500), 1);
  assert.equal(wheelUnit(1, 500), 16);
  assert.equal(wheelUnit(2, 500), 500);
  // A photo that still fits stays centred.
  assert.equal(constrainOffset(30, 100, 50, 1.5), -25);
  // An enlarged photo can't leave a gap at either edge.
  assert.ok(constrainOffset(10, 100, 100, 2) === 0);
  assert.equal(constrainOffset(-500, 100, 100, 2), -100);
  assert.equal(anchoredOffset(50, 0, 2), -50);
  assert.deepEqual(
    pinch([
      { x: 0, y: 0 },
      { x: 6, y: 8 }
    ]),
    { point: { x: 3, y: 4 }, distance: 10 }
  );
});
