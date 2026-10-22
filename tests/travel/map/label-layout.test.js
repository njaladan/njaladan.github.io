import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collides,
  compareLabels,
  fitsFeature,
  inZoomBand,
  insideView,
  labelRect
} from '../../../assets/js/travel/map/label-layout.js';

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
