import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chipButton,
  drawSchedule,
  filterShapes,
  pointsAttr,
  prepareShapes,
  shapeCell,
  shapeEnds,
  shapeYears,
  stackAlpha,
  stackFits
} from '../../assets/js/athletics/shapes.js';

const raw = [
  { date: '2023-04-01', sport: 'run', segs: [[0, 0, 10, 10]] },
  {
    date: '2024-06-02',
    sport: 'ride',
    segs: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  },
  { date: '2024-01-09', sport: 'run', segs: [[0, 0]] }
];

test('prepareShapes adds numeric years and shuffles with the given random source', () => {
  const shapes = prepareShapes(raw, () => 0);
  assert.equal(shapes.length, 3);
  assert.deepEqual(shapes.map(s => s.year).sort(), [2023, 2024, 2024]);
  assert.deepEqual(shapeYears(shapes), [2023, 2024]);
  // A random source of 0 swaps each element with the first: [a, b, c] -> [b, c, a].
  assert.deepEqual(
    shapes.map(s => s.date),
    ['2024-06-02', '2024-01-09', '2023-04-01']
  );
});

test('filterShapes by sport and year', () => {
  const shapes = prepareShapes(raw, () => 0.99);
  assert.equal(filterShapes(shapes, { sport: 'all', year: 'all' }).length, 3);
  assert.equal(filterShapes(shapes, { sport: 'run', year: 'all' }).length, 2);
  assert.equal(filterShapes(shapes, { sport: 'run', year: 2024 }).length, 1);
  assert.equal(filterShapes(shapes, { sport: 'snow', year: 'all' }).length, 0);
});

test('SVG markup carries only numbers and escaped text', () => {
  assert.equal(pointsAttr([1, 2, 3.5, 4]), '1,2 3.5,4 ');
  assert.equal(pointsAttr(['1"><script>', 2]), 'NaN,2 ');
  const [shape] = prepareShapes([raw[1]]);
  const cell = shapeCell(shape, 7);
  assert.match(cell, /data-n="7"/);
  assert.match(cell, /aria-label="Ride, June 2, 2024"/);
  assert.equal((cell.match(/<polyline /g) || []).length, 2);
  assert.match(shapeEnds(shape), /cx="1" cy="2".*cx="7" cy="8"/);
});

test('chipButton escapes labels and adds sport swatches', () => {
  assert.equal(
    chipButton({ key: 'all', text: 'Everything', swatch: true }),
    '<button type="button" aria-pressed="true">Everything</button>'
  );
  assert.equal(
    chipButton({ key: 'foot', text: 'Hiking & walking', swatch: true }),
    '<button type="button" aria-pressed="false"><span class="shape-swatch" style="background:#7a9a22"></span>Hiking &amp; walking</button>'
  );
  assert.equal(
    chipButton({ key: 2024, text: '2024', swatch: false }),
    '<button type="button" aria-pressed="false">2024</button>'
  );
});

test('stackAlpha fades with more routes, within bounds', () => {
  assert.equal(stackAlpha(0), 0.6);
  assert.equal(stackAlpha(100), 0.35);
  assert.equal(stackAlpha(1e6), 0.05);
});

test('drawSchedule splits the duration by length', () => {
  assert.deepEqual(drawSchedule([1, 3], 400), [
    { delay: 0, share: 100 },
    { delay: 100, share: 300 }
  ]);
  assert.deepEqual(drawSchedule([0], 400), [{ delay: 0, share: 0 }]);
});

test('stackFits sizes routes by spread and keeps every route inside the box', () => {
  const big = { segs: [[300, 500, 500, 300, 700, 500, 500, 700, 300, 500]] };
  const small = { segs: [[400, 500, 500, 400, 600, 500, 500, 600, 400, 500]] };
  const line = { segs: [[0, 500, 250, 500, 500, 500, 750, 500, 1000, 500]] };
  const shapes = /** @type {any[]} */ ([big, small, line]);
  stackFits(shapes);
  // Rings of any size come out the same size; the long line shrinks to stay in the box.
  assert.ok(Math.abs(200 * big.fit - 100 * small.fit) < 1e-9);
  for (const s of shapes) {
    for (const v of s.segs[0]) assert.ok(Math.abs((v - 500) * s.fit) <= 500 + 1e-9);
  }
});
