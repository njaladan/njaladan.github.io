import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collides,
  compareLabels,
  fitsFeature,
  inZoomBand,
  insideView,
  labelRect
} from '../../assets/js/travel/ui/label-layout.js';
import { clusterPhotos, photoSpacing, pinFits } from '../../assets/js/travel/ui/photo-clusters.js';
import { printCurves, printSlot, printTiming } from '../../assets/js/travel/ui/print-motion.js';
import {
  anchoredOffset,
  constrainOffset,
  pinch,
  wheelUnit
} from '../../assets/js/travel/ui/zoom-math.js';
import { mediumFrame, onScreen } from '../../assets/js/travel/ui/viewer-geometry.js';

test('labels sort countries, states, then cities by size and rank', () => {
  const labels = [
    { kind: 'city', rank: 1, extent: 0 },
    { kind: 'state', rank: 0, extent: 1, bounds: {} },
    { kind: 'country', rank: 0, extent: 1, bounds: {} },
    { kind: 'country', rank: 0, extent: 5, bounds: {} },
    { kind: 'city', rank: 1, extent: 0, visible: true }
  ];
  const sorted = [...labels].sort(compareLabels);
  assert.deepEqual(sorted, [labels[3], labels[2], labels[1], labels[4], labels[0]]);
});

test('zoom bands have hysteresis', () => {
  assert.equal(inZoomBand({ kind: 'country', rank: 0 }, 7.1, true), true);
  assert.equal(inZoomBand({ kind: 'country', rank: 0 }, 7.1, false), false);
  assert.equal(inZoomBand({ kind: 'state', rank: 0 }, 4.5, false), false);
  assert.equal(inZoomBand({ kind: 'state', rank: 0 }, 4.6, false), true);
  assert.equal(inZoomBand({ kind: 'city', rank: 2 }, 6.2, false), false);
  assert.equal(inZoomBand({ kind: 'city', rank: 2 }, 6.3, false), true);
});

test('label rectangles, fit, view and collisions', () => {
  const rect = labelRect({ x: 100, y: 50 }, { width: 40, height: 10 }, { left: 10, top: 20 });
  assert.deepEqual(rect, { left: 90, right: 130, top: 65, bottom: 75, width: 40, height: 10 });
  assert.equal(fitsFeature(rect, { x: 50, y: -20 }, true), true);
  assert.equal(fitsFeature(rect, { x: 50, y: -20 }, false), false);
  assert.equal(insideView(rect, { left: 10, top: 20 }, { x: 200, y: 100 }), true);
  assert.equal(insideView(rect, { left: 10, top: 20 }, { x: 200, y: 80 }), false);
  const near = { ...rect, left: 135, right: 175 };
  assert.equal(collides(rect, [near], true), false);
  assert.equal(collides(rect, [near], false), true);
});

test('clusterPhotos groups by screen distance in photo order', () => {
  const photos = [
    { id: 'a', coords: [100, 100] },
    { id: 'b', coords: [110, 100] },
    { id: 'c', coords: [200, 200] },
    { id: 'edge', coords: [5, 200] },
    { id: 'hidden', coords: [300, 300] }
  ];
  const groups = clusterPhotos(photos, {
    project: ([x, y]) => ({ x, y }),
    size: { x: 400, y: 400 },
    spacing: photoSpacing(3),
    isVisible: coords => coords[0] !== 300
  });
  assert.deepEqual(
    groups.map(group => group.items.map(photo => photo.id)),
    [['a', 'b'], ['c']]
  );
  assert.equal(photoSpacing(8), 32);
  assert.equal(pinFits({ x: 30, y: 80 }, { x: 100, y: 200 }), true);
});

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

test('medium viewer frame stays inside the map band', () => {
  const frame = mediumFrame({
    mapBox: { left: 0, top: 0, width: 1000, height: 800, bottom: 800 },
    viewport: { width: 1000, height: 800 },
    ratio: 1.5,
    chromeHeight: 80,
    anchor: null
  });
  assert.equal(frame.width, 400);
  assert.ok(frame.top >= 72 && frame.top + frame.height <= 800 - 12);
  assert.equal(frame.left, 300);
  assert.equal(
    onScreen(
      { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
      { width: 5, height: 5 }
    ),
    true
  );
  assert.equal(
    onScreen(
      { left: 20, top: 0, right: 30, bottom: 10, width: 10, height: 10 },
      { width: 5, height: 5 }
    ),
    false
  );
});
