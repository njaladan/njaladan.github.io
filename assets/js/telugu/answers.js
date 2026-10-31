// Yes/no answers for the Telugu checklist. Answers are a plain object keyed by film id;
// insertion order is answer order, so the last key is the one undo removes.

/** @typedef {'yes' | 'no' | 'unsure'} Answer */
/** @typedef {Record<string, Answer>} Answers */

export const ANSWERS = /** @type {const} */ (['yes', 'no', 'unsure']);

/**
 * Answers parsed from saved JSON, keeping only known films and values.
 * @param {string | null} raw
 * @param {Set<string>} ids
 * @returns {Answers}
 */
export function parseAnswers(raw, ids) {
  /** @type {Answers} */
  const answers = {};
  let saved;
  try {
    saved = JSON.parse(raw ?? '{}');
  } catch {
    return answers;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return answers;
  for (const [id, value] of Object.entries(saved)) {
    if (ids.has(id) && ANSWERS.includes(value)) answers[id] = value;
  }
  return answers;
}

/**
 * Records an answer as the most recent one.
 * @param {Answers} answers
 * @param {string} id
 * @param {Answer} value
 * @returns {Answers}
 */
export function answer(answers, id, value) {
  const next = { ...answers };
  delete next[id];
  next[id] = value;
  return next;
}

/**
 * Removes the most recent answer, returning the new answers and the film it was for.
 * @param {Answers} answers
 * @returns {{ answers: Answers, id: string | null }}
 */
export function undo(answers) {
  const ids = Object.keys(answers);
  const id = ids.at(-1) ?? null;
  if (id == null) return { answers, id };
  const rest = { ...answers };
  delete rest[id];
  return { answers: rest, id };
}

/**
 * The highest-ranked film without an answer.
 * @template {{ id: string }} F
 * @param {F[]} films
 * @param {Answers} answers
 * @returns {F | undefined}
 */
export const nextFilm = (films, answers) => films.find(film => !(film.id in answers));

/**
 * @param {Answers} answers
 * @returns {Record<Answer, number> & { answered: number }}
 */
export function tally(answers) {
  const counts = { yes: 0, no: 0, unsure: 0, answered: 0 };
  for (const value of Object.values(answers)) {
    counts[value]++;
    counts.answered++;
  }
  return counts;
}
