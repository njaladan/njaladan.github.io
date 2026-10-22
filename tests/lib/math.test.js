import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp } from '../../assets/js/lib/math.js';

test('clamp keeps values within range', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});
