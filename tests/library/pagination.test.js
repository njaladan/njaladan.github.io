import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STRIPS,
  clampSpread,
  edgeOf,
  folioText,
  heldAngles,
  holdFor,
  leafPages,
  pageCountFor,
  spreadLayout,
  stripAngle,
  stripEdges
} from '../../assets/js/library/pagination.js';

test('page and spread arithmetic', () => {
  assert.equal(pageCountFor(300, 300, 320), 1);
  assert.equal(pageCountFor(940, 300, 320), 3);
  assert.equal(pageCountFor(0, 300, 320), 1);
  assert.deepEqual(spreadLayout(5, false), { lead: 1, lastSpread: 2 });
  assert.deepEqual(spreadLayout(5, true), { lead: 0, lastSpread: 4 });
  assert.deepEqual(leafPages(0, false), [-1, 0]);
  assert.deepEqual(leafPages(2, false), [3, 4]);
  assert.deepEqual(leafPages(2, true), [2, Infinity]);
  assert.equal(clampSpread(-1, 3), 0);
  assert.equal(clampSpread(9, 3), 3);
  assert.equal(folioText(0, 5, false), '1–2 of 5');
  assert.equal(folioText(2, 5, false), '5 of 5');
  assert.equal(folioText(1, 5, true), '2 of 5');
});

test('page curl starts flat and ends fully turned', () => {
  for (let index = 0; index < STRIPS; index++) {
    assert.equal(stripAngle(0, index, true), -0);
    assert.equal(stripAngle(1, index, true), -180);
    assert.equal(stripAngle(1, index, false), -0);
  }
  const edges = stripEdges(101);
  assert.equal(edges.length, STRIPS + 1);
  assert.equal(edges[0], 0);
  assert.equal(edges.at(-1), 101);
});

test('a held page keeps its free edge under the finger', () => {
  assert.equal(edgeOf(heldAngles(0, true)), 1);
  assert.equal(edgeOf(heldAngles(1, true)), -1);
  assert.equal(edgeOf(heldAngles(0, false)), -1);
  assert.equal(edgeOf(heldAngles(1, false)), 1);
  for (const turned of [true, false]) {
    for (const edge of [-0.8, -0.2, 0, 0.3, 0.9]) {
      assert.ok(Math.abs(edgeOf(heldAngles(holdFor(edge, turned), turned)) - edge) < 1e-4);
    }
  }
  const angles = heldAngles(0.5, true);
  assert.ok(angles.at(-1) < angles[0], 'the free edge leads');
});
