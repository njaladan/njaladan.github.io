import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupKey,
  isAtlasPhotoPath,
  normalizePhotos,
  photoDepths,
  photoLabel,
  viewerVariant
} from '../../../assets/js/travel/photos/records.js';

const variant = (name, width) => ({ src: `images/travel/trip/${name}.webp`, width });

const photo = (id, extra = {}) => ({
  id,
  place: 'Place',
  coords: [1, 2],
  width: 300,
  height: 200,
  variants: {
    thumbnail: variant(`${id}-t`, 80),
    small: variant(`${id}-s`, 400),
    medium: variant(`${id}-m`, 800),
    large: variant(`${id}-l`, 1600)
  },
  ...extra
});

test('isAtlasPhotoPath accepts only atlas image paths', () => {
  assert.equal(isAtlasPhotoPath('images/travel/a-b/c-1.jpg'), true);
  assert.equal(isAtlasPhotoPath('https://evil.test/a.jpg'), false);
  assert.equal(isAtlasPhotoPath('images/travel/../x.jpg'), false);
  assert.equal(isAtlasPhotoPath(undefined), false);
});

test('normalizePhotos validates, dedupes and sorts newest first', () => {
  const photos = normalizePhotos([
    photo('b', { date: '2020-01-01' }),
    photo('a', { date: '2020-01-01' }),
    photo('c', { date: '2023-01-01' }),
    photo('a'),
    photo('bad', { coords: [91, 0] }),
    {
      ...photo('remote'),
      variants: { ...photo('x').variants, large: { src: 'http://x/y.jpg', width: 1 } }
    },
    null
  ]);
  assert.deepEqual(
    photos.map(item => item.id),
    ['c', 'a', 'b']
  );
  assert.deepEqual(
    [...photoDepths(photos)],
    [
      ['c', 1003],
      ['a', 1002],
      ['b', 1001]
    ]
  );
  assert.equal(normalizePhotos('nope').length, 0);
});

test('photoLabel and groupKey', () => {
  assert.equal(
    photoLabel(photo('a', { gallery: { subject: 'Peak', location: 'Alps' } })),
    'Peak — Alps'
  );
  assert.equal(photoLabel(photo('a')), 'Place');
  assert.equal(groupKey([photo('a'), photo('b')]), 'a|b');
});

test('viewerVariant picks the smallest sufficient width', () => {
  assert.equal(viewerVariant(photo('a'), 500).width, 800);
  assert.equal(viewerVariant(photo('a'), 5000).width, 1600);
  assert.equal(viewerVariant(photo('a'), 10).width, 400);
});
