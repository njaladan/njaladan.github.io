import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clamp,
  linePath,
  longitudeDelta,
  panOverflow,
  ringPath,
  sameLongitude,
  sunLight
} from '../../assets/js/travel/globe/math.js';
import {
  FLING_SECONDS,
  IDLE_SPEED,
  addSample,
  flingTravel,
  idleRise,
  introTravel,
  releaseSpeed,
  splitEase
} from '../../assets/js/travel/globe/spin-curves.js';

test('clamp keeps values within range', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('sunLight anchors the light at the subsolar point', () => {
  // June solstice, noon UTC: the sun stands over the Tropic of Cancer near 0°.
  const { anchor, position } = sunLight(new Date(Date.UTC(2024, 5, 20, 12)));
  assert.equal(anchor, 'map');
  assert.equal(position[0], 1.15);
  const azimuth = ((position[1] + 90) * Math.PI) / 180,
    polar = (position[2] * Math.PI) / 180;
  // The light points away from the sun, so negate to find it.
  const x = -Math.sin(polar) * Math.cos(azimuth),
    y = -Math.sin(polar) * Math.sin(azimuth),
    z = -Math.cos(polar);
  const lat = (Math.asin(y) * 180) / Math.PI,
    lng = (Math.atan2(x, z) * 180) / Math.PI;
  assert.ok(Math.abs(lat - 23.44) < 0.1, `lat ${lat}`);
  assert.ok(Math.abs(lng) < 2, `lng ${lng}`);
});

test('panOverflow pans far edges first and respects padding', () => {
  const root = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.deepEqual(
    panOverflow({ left: 10, top: 80, right: 95, bottom: 90 }, root, [20, 70], [20, 20]),
    [15, 10]
  );
  assert.deepEqual(
    panOverflow({ left: 5, top: 30, right: 40, bottom: 50 }, root, [20, 70], [20, 20]),
    [-15, -40]
  );
  assert.deepEqual(
    panOverflow({ left: 30, top: 75, right: 60, bottom: 79 }, root, [20, 70], [20, 20]),
    [0, 0]
  );
});

test('linePath and ringPath format SVG path data', () => {
  const pts = [
    { x: 1, y: 2 },
    { x: 3.456, y: 4 }
  ];
  assert.equal(linePath([pts, pts]), 'M1.00,2.00L3.46,4.00M1.00,2.00L3.46,4.00');
  assert.equal(ringPath(pts), '');
  assert.equal(ringPath([...pts, { x: 0, y: 0 }]), 'M1.00,2.00L3.46,4.00L0.00,0.00Z');
});

test('longitudes wrap across the dateline', () => {
  assert.equal(longitudeDelta(-170, 170), 20);
  assert.equal(longitudeDelta(170, -170), -20);
  assert.ok(sameLongitude(180, -180));
  assert.ok(sameLongitude(10, 370));
  assert.ok(!sameLongitude(10, 11));
});

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
