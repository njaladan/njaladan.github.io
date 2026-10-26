import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardMatches,
  compareCards,
  fold,
  foldedGroups,
  groupBy,
  groupKey,
  groupLabels,
  keyFromId
} from '../../assets/js/library/shelf.js';

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

test('foldedGroups keeps the two most recent years open in either date order', () => {
  const keys = ['2026', '2025', '2024', '2023', 'earlier'];
  assert.deepEqual([...foldedGroups(keys, '', 'newest')], ['2024', '2023', 'earlier']);
  assert.deepEqual(
    [...foldedGroups([...keys].reverse(), '', 'oldest')],
    ['earlier', '2023', '2024']
  );
});

test('foldedGroups folds nothing while searching, by title, or on a short shelf', () => {
  const keys = ['2026', '2025', '2024', 'earlier'];
  assert.equal(foldedGroups(keys, 'heat', 'newest').size, 0);
  assert.equal(foldedGroups(['all', 'earlier'], '', 'title').size, 0);
  assert.equal(foldedGroups(['2026', '2025', 'earlier'], '', 'newest').size, 0);
});

test('keyFromId reads the group key from a section id', () => {
  assert.equal(keyFromId('y2017'), '2017');
  assert.equal(keyFromId('earlier'), 'earlier');
  assert.equal(keyFromId('all-items'), 'all-items');
});
