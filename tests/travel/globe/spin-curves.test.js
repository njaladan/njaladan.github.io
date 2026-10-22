import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FLING_SECONDS,
  IDLE_SPEED,
  addSample,
  flingTravel,
  idleRise,
  introTravel,
  releaseSpeed,
  splitEase
} from '../../../assets/js/travel/globe/spin-curves.js';

test('spin curves start at zero and settle to the idle speed', () => {
  assert.equal(introTravel(0), 0);
  assert.equal(idleRise(0), 0);
  const slope = (curve, t) => (curve(t + 1e-3) - curve(t)) / 1e-3;
  assert.ok(slope(introTravel, 0) > 80);
  assert.ok(Math.abs(slope(introTravel, 30) - IDLE_SPEED) < 0.01);
  assert.ok(Math.abs(slope(idleRise, 30) - IDLE_SPEED) < 0.01);
  assert.ok(Math.abs(slope(t => flingTravel(-200, t), 0) + 200) < 0.5);
  assert.ok(Math.abs(slope(t => flingTravel(-200, t), 30) + IDLE_SPEED) < 0.01);
  assert.ok(flingTravel(200, FLING_SECONDS) > 0);
});

test('drag samples unwrap the dateline and keep a short window', () => {
  let samples = addSample([], 0, 175);
  samples = addSample(samples, 50, -175);
  assert.deepEqual(
    samples.map(s => s.lng),
    [175, 185]
  );
  samples = addSample(samples, 200, -170);
  assert.deepEqual(samples, [{ now: 200, lng: 190 }]);
});

test('releaseSpeed measures throws and ignores pauses', () => {
  const samples = [
    { now: 0, lng: 10 },
    { now: 100, lng: 0 }
  ];
  assert.equal(releaseSpeed(samples, 150), 100);
  assert.equal(releaseSpeed(samples, 400), null);
  assert.equal(releaseSpeed(samples.slice(0, 1), 50), null);
  assert.equal(releaseSpeed([], 0), null);
  assert.equal(
    releaseSpeed(
      [
        { now: 0, lng: 0 },
        { now: 10, lng: 100 }
      ],
      20
    ),
    -400
  );
});

test('splitEase cuts a turn into equal legs that join up', () => {
  const easing = t => flingTravel(400, t * FLING_SECONDS) / flingTravel(400, FLING_SECONDS);
  const legs = splitEase(easing, 6);
  assert.equal(legs.length, 6);
  assert.equal(legs[0].start, 0);
  assert.equal(legs[5].end, 1);
  for (const [i, leg] of legs.entries()) {
    assert.ok(Math.abs(leg.easing(0)) < 1e-6);
    assert.ok(Math.abs(leg.easing(1) - 1) < 1e-6);
    if (i) assert.equal(leg.start, legs[i - 1].end);
  }
});
