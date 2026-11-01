import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const movies = JSON.parse(
  readFileSync(new URL('../../_data/movies.json', import.meta.url), 'utf8')
);
const filmIds = new Set(movies.films.map(film => film.id));

test('every viewing and undated entry names a film that exists', () => {
  const missing = [...movies.viewings.map(viewing => viewing.film_id), ...movies.earlier].filter(
    id => !filmIds.has(id)
  );
  assert.deepEqual(missing, []);
});
