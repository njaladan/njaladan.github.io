import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeIndex, queryFor, readQuery } from '../../assets/js/lib/collection.js';

const defaults = { q: '', show: 'all', sort: 'newest' };

test('queryFor leaves out empty and default values', () => {
  assert.equal(queryFor(defaults, defaults), '');
  assert.equal(
    queryFor({ q: 'heat ', show: 'all', sort: 'title' }, defaults),
    '?q=heat+&sort=title'
  );
});

test('readQuery falls back to the defaults and ignores other keys', () => {
  assert.deepEqual(readQuery('', defaults), defaults);
  assert.deepEqual(readQuery('?sort=oldest&year=2019&q=caf%C3%A9', defaults), {
    q: 'café',
    show: 'all',
    sort: 'oldest'
  });
  assert.deepEqual(readQuery(queryFor({ ...defaults, q: 'a&b' }, defaults), defaults), {
    ...defaults,
    q: 'a&b'
  });
});

test('activeIndex picks the last section scrolled up to the line', () => {
  assert.equal(activeIndex([], 60), -1);
  assert.equal(activeIndex([200, 900], 60), 0);
  assert.equal(activeIndex([-500, 61, 900], 61), 1);
  assert.equal(activeIndex([-900, -400, -10], 60), 2);
  assert.equal(activeIndex([-100, Infinity], 60), 0);
});
