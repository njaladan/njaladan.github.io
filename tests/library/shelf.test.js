import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareCards,
  groupBy,
  groupKey,
  groupLabels,
  keyFromId,
  matchesQuery
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

test('compareCards orders by date in either direction, undated films last', () => {
  assert.deepEqual(sorted(cards, 'newest'), ['C', 'A', 'D', 'B', 'Y', 'Z']);
  assert.deepEqual(sorted(cards, 'oldest'), ['B', 'A', 'C', 'D', 'Y', 'Z']);
});

test('compareCards breaks ties between undated items in a year by title', () => {
  const pair = [
    { title: 'Q', section: 'books', year: '2020' },
    { title: 'P', section: 'books', year: '2020' }
  ];
  assert.deepEqual(sorted(pair, 'newest'), ['P', 'Q']);
});

test('groupKey and groupLabels', () => {
  assert.equal(groupKey({ section: 'earlier' }), 'earlier');
  assert.equal(groupKey({ section: 'diary', date: '2021-01-01' }), '2021');
  assert.equal(groupKey({ section: 'books', year: '2019', date: '2021-01-01' }), '2019');
  assert.deepEqual(groupLabels('earlier', 'movies'), {
    id: 'earlier',
    heading: 'Undated',
    link: 'Undated',
    noun: 'movies'
  });
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

test('keyFromId reads the group key from a section id', () => {
  assert.equal(keyFromId('y2017'), '2017');
  assert.equal(keyFromId('earlier'), 'earlier');
});

test('matchesQuery finds every word at the start of a word in the title', () => {
  assert.equal(matchesQuery('The Dark Knight', ''), true);
  assert.equal(matchesQuery('The Dark Knight', 'dark'), true);
  assert.equal(matchesQuery('The Dark Knight', 'knight dar'), true);
  assert.equal(matchesQuery('The Dark Knight', 'ark'), false);
  assert.equal(matchesQuery('The Dark Knight', 'dark rises'), false);
});

test('matchesQuery ignores case, accents and punctuation', () => {
  assert.equal(matchesQuery('Amélie', 'AMELIE'), true);
  assert.equal(matchesQuery('WALL·E', 'wall e'), true);
  assert.equal(matchesQuery("Ocean's Eleven", 'oceans'), true);
  assert.equal(matchesQuery('Ocean’s Eleven', "ocean's 11"), false);
  assert.equal(matchesQuery('Spider-Man: No Way Home', 'spider man'), true);
});
