import assert from 'node:assert/strict';
import { test } from 'node:test';
import { icon } from '../../../assets/js/travel/shared/route-icons.js';

test('icon falls back to the car glyph for unknown and inherited keys', () => {
  assert.equal(icon('nope'), icon('Drive'));
  assert.equal(icon('toString'), icon('Drive'));
  assert.notEqual(icon('Flight'), icon('Drive'));
});
