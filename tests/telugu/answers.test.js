import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answer, nextFilm, parseAnswers, tally, undo } from '../../assets/js/telugu/answers.js';

const films = [{ id: 'eega-2012' }, { id: 'rrr-2022' }, { id: 'pokiri-2006' }];
const ids = new Set(films.map(film => film.id));

test('saved answers keep only known films and values', () => {
  assert.deepEqual(parseAnswers(null, ids), {});
  assert.deepEqual(parseAnswers('not json', ids), {});
  assert.deepEqual(parseAnswers('[]', ids), {});
  assert.deepEqual(
    parseAnswers('{"rrr-2022":"yes","eega-2012":"maybe","gone-1999":"no","pokiri-2006":"no"}', ids),
    { 'rrr-2022': 'yes', 'pokiri-2006': 'no' }
  );
});

test('answering walks the list in rank order and undo steps back', () => {
  let answers = {};
  assert.equal(nextFilm(films, answers)?.id, 'eega-2012');
  answers = answer(answers, 'eega-2012', 'yes');
  answers = answer(answers, 'rrr-2022', 'unsure');
  assert.equal(nextFilm(films, answers)?.id, 'pokiri-2006');
  assert.deepEqual(tally(answers), { yes: 1, no: 0, unsure: 1, answered: 2 });

  const undone = undo(answers);
  assert.equal(undone.id, 'rrr-2022');
  assert.equal(nextFilm(films, undone.answers)?.id, 'rrr-2022');
  assert.deepEqual(undo({}), { answers: {}, id: null });
});

test('re-answering a film makes it the most recent answer', () => {
  let answers = answer({}, 'eega-2012', 'no');
  answers = answer(answers, 'rrr-2022', 'yes');
  answers = answer(answers, 'eega-2012', 'yes');
  assert.deepEqual(Object.keys(answers), ['rrr-2022', 'eega-2012']);
  assert.equal(undo(answers).id, 'eega-2012');
  answers = answer(answers, 'pokiri-2006', 'yes');
  assert.equal(nextFilm(films, answers), undefined);
});
