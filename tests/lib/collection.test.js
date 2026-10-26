import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeIndex,
  queryFor,
  railAt,
  railTrack,
  readQuery
} from '../../assets/js/lib/collection.js';

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

const years = [
  { left: 0, right: 50 },
  { left: 50, right: 100 },
  { left: 100, right: 150 }
];

test('railTrack holds on each link and stretches across on the way to the next', () => {
  const stops = railTrack([-Infinity, 1000, 3000], years, 5000);
  assert.deepEqual(railAt(stops, -200), years[0]);
  assert.deepEqual(railAt(stops, 800), years[0]);
  assert.deepEqual(railAt(stops, 1000), years[1]);
  assert.deepEqual(railAt(stops, 2800), years[1]);
  assert.deepEqual(railAt(stops, 6000), years[2]);
  // Halfway over, the leading edge is ahead of the trailing one: stretched.
  const middle = railAt(stops, 920);
  assert.ok(middle.right - middle.left > 60);
  assert.ok(middle.left >= 0 && middle.right <= 100);
});

test('railTrack moves continuously and squeezes moves between close years', () => {
  const stops = railTrack([-Infinity, 1000, 1050], years, 5000);
  for (let y = 900; y < 1200; y += 1) {
    const a = railAt(stops, y);
    const b = railAt(stops, y + 1);
    assert.ok(Math.abs(b.left - a.left) < 5 && Math.abs(b.right - a.right) < 5, `at ${y}`);
  }
  assert.ok(stops.every((stop, index) => index === 0 || stop.y >= stops[index - 1].y));
});

test('railTrack leaves out years the page cannot scroll to', () => {
  const stops = railTrack([-Infinity, 1000, 3000], years, 2000);
  assert.deepEqual(railAt(stops, 2000), years[1]);
  assert.deepEqual(railTrack([], [], 100), []);
});
