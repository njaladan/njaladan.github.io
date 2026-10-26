import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeIndex,
  createMotion,
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

test('railTrack rests on each link where its section starts, gliding over before it', () => {
  const stops = railTrack([0, 1000, 3000], years, 5000);
  assert.deepEqual(railAt(stops, -200), years[0]);
  assert.deepEqual(railAt(stops, 700), years[0]);
  assert.deepEqual(railAt(stops, 1000), years[1]);
  assert.deepEqual(railAt(stops, 2700), years[1]);
  assert.deepEqual(railAt(stops, 6000), years[2]);
  // Halfway through the glide, halfway between.
  assert.deepEqual(railAt(stops, 880), { left: 25, right: 75 });
});

test('railTrack glides steadily through close years, without resting', () => {
  const stops = railTrack([0, 100, 200], years, 5000);
  const centre = y => {
    const { left, right } = railAt(stops, y);
    return (left + right) / 2;
  };
  for (let y = 0; y < 200; y += 10) assert.equal(centre(y + 10) - centre(y), 5, `at ${y}`);
  assert.ok(stops.every((stop, index) => index === 0 || stop.y >= stops[index - 1].y));
});

test('railTrack leaves out years the page cannot scroll to', () => {
  const stops = railTrack([0, 1000, 3000], years, 2000);
  assert.deepEqual(railAt(stops, 2000), years[1]);
  assert.deepEqual(railTrack([], [], 100), []);
});

test('createMotion trails a tail while scrolling and rests unstretched on the link once still', () => {
  const motion = createMotion();
  const rest = { left: 50, right: 100 };
  let time = 0;
  let frame;
  // Scrolling: gliding right a few pixels a frame draws out a tail behind.
  for (let x = 0; x < 30; x += 3) {
    time += 16;
    frame = motion.at({ left: 40 + x, right: 90 + x }, rest, time, false);
  }
  assert.ok(frame.right - frame.left > 55, 'stretched while moving');
  assert.ok(frame.moving);
  // Still, partway between two links: it settles onto the marked one, at its own size.
  for (let step = 0; step < 40; step++) {
    time += 16;
    frame = motion.at({ left: 70, right: 120 }, rest, time, true);
  }
  assert.deepEqual(frame, { ...rest, moving: false });
});
