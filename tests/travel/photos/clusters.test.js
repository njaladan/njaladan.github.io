import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterPhotos, photoSpacing, pinFits } from '../../../assets/js/travel/photos/clusters.js';

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
