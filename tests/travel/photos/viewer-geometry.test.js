import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediumFrame, onScreen } from '../../../assets/js/travel/photos/viewer-geometry.js';

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
