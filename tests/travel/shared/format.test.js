import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  plural
} from '../../../assets/js/travel/shared/format.js';

test('formatters', () => {
  assert.deepEqual(formatDistance(1.609344, 1, 'mi'), ['1.0', 'Miles']);
  assert.deepEqual(formatDistance(12, 0, 'km'), ['12', 'Km']);
  assert.deepEqual(formatElevation(120, 'km'), ['120', 'm']);
  assert.deepEqual(formatElevation(304.8, 'mi'), ['1,000', 'ft']);
  assert.equal(formatDuration(5400), '1:30');
  assert.equal(formatDuration(59), '0:01');
  assert.equal(plural(1, 'day'), '1 day');
  assert.equal(plural(3, 'day'), '3 days');
});
