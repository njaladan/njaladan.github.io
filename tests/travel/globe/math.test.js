import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  linePath,
  longitudeDelta,
  panOverflow,
  ringPath,
  sameLongitude,
  sunLight
} from '../../../assets/js/travel/globe/math.js';

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
