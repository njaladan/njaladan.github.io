import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardMatches,
  compareCards,
  fold,
  groupBy,
  groupKey,
  groupLabels
} from '../../assets/js/library/shelf.js';
import {
  clampSpread,
  folioText,
  leafPages,
  pageCountFor,
  spreadLayout,
  stripAngle,
  stripEdges,
  STRIPS
} from '../../assets/js/library/pagination.js';

test('fold drops accents and case', () => {
  assert.equal(fold('Amélie À BOUT'), 'amelie a bout');
});

test('cardMatches applies the folded query and category', () => {
  const card = { title: 'Amélie', section: 'diary', notes: 'true' };
  assert.ok(cardMatches(card, fold('AMEL'), 'all'));
  assert.ok(!cardMatches(card, 'zzz', 'all'));
  assert.ok(cardMatches(card, '', 'notes'));
  assert.ok(!cardMatches({ ...card, notes: 'false' }, '', 'notes'));
  assert.ok(cardMatches(card, '', 'diary'));
  assert.ok(!cardMatches(card, '', 'earlier'));
  assert.ok(cardMatches({}, '', 'all'));
});

const sorted = (cards, order) =>
  [...cards].sort((a, b) => compareCards(a, b, order)).map(card => card.title);

const cards = [
  { title: 'B', section: 'diary', date: '2023-05-01' },
  { title: 'A', section: 'diary', date: '2024-01-02' },
  { title: 'C', section: 'diary', date: '2024-03-01' },
  { title: 'Z', section: 'earlier' },
  { title: 'Y', section: 'earlier' },
  { title: 'D', section: 'diary', year: '2024' }
];

test('compareCards orders by date in either direction, undated films last', () => {
  assert.deepEqual(sorted(cards, 'newest'), ['C', 'A', 'D', 'B', 'Y', 'Z']);
  assert.deepEqual(sorted(cards, 'oldest'), ['B', 'A', 'C', 'D', 'Y', 'Z']);
  assert.deepEqual(sorted(cards, 'title'), ['A', 'B', 'C', 'D', 'Y', 'Z']);
});

test('compareCards breaks ties between undated items in a year by title', () => {
  const pair = [
    { title: 'Q', section: 'books', year: '2020' },
    { title: 'P', section: 'books', year: '2020' }
  ];
  assert.deepEqual(sorted(pair, 'newest'), ['P', 'Q']);
});

test('groupKey and groupLabels', () => {
  assert.equal(groupKey({ section: 'earlier' }, 'newest'), 'earlier');
  assert.equal(groupKey({ section: 'diary', date: '2021-01-01' }, 'title'), 'all');
  assert.equal(groupKey({ section: 'diary', date: '2021-01-01' }, 'newest'), '2021');
  assert.equal(groupKey({ section: 'books', year: '2019', date: '2021-01-01' }, 'oldest'), '2019');
  assert.deepEqual(groupLabels('earlier', 'movies'), {
    id: 'earlier',
    heading: 'Undated',
    link: 'Undated',
    noun: 'movies'
  });
  assert.deepEqual(groupLabels('all', 'movies'), {
    id: 'all-items',
    heading: 'The diary',
    link: 'The collection',
    noun: 'viewings'
  });
  assert.equal(groupLabels('all', 'books').heading, 'The collection');
  assert.deepEqual(groupLabels('2024', 'books'), {
    id: 'y2024',
    heading: '2024',
    link: '2024',
    noun: 'books'
  });
});

test('groupBy keeps first-appearance order', () => {
  const groups = groupBy([1, 2, 3, 4, 5], n => (n % 2 ? 'odd' : 'even'));
  assert.deepEqual(
    [...groups],
    [
      ['odd', [1, 3, 5]],
      ['even', [2, 4]]
    ]
  );
});

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
