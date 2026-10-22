import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDecodedCache } from '../../../assets/js/travel/photos/decoded.js';

test('decoded cache keeps wider entries, evicts by count and pixels', () => {
  const cache = createDecodedCache({ maxEntries: 2, maxPixels: 100 });
  cache.remember('a', { src: 'a1', width: 10, pixelCount: 10 });
  cache.remember('a', { src: 'a0', width: 5, pixelCount: 5 });
  assert.equal(cache.take('a', ['a1']).src, 'a1');
  cache.remember('b', { src: 'b', width: 1, pixelCount: 10 });
  cache.remember('c', { src: 'c', width: 1, pixelCount: 10 });
  assert.equal(cache.size, 2);
  assert.equal(cache.take('a', ['a1']), null);
  cache.remember('d', { src: 'd', width: 1, pixelCount: 200 });
  assert.equal(cache.size, 1);
  assert.equal(cache.pixels, 200);
  assert.equal(cache.take('d', ['other']), null);
  assert.equal(cache.pixels, 0);
});
