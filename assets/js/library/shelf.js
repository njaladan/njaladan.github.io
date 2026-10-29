// Pure shelf logic for the books and movies pages: ordering and grouping cards by the
// values in their data-* attributes. Nothing here touches the DOM.

/**
 * The data-* values a library card carries.
 * @typedef {object} CardData
 * @property {string} [title]
 * @property {string} [section] `earlier` for undated films.
 * @property {string} [year]
 * @property {string} [date] ISO date.
 * @property {string} [filmId]
 */

/**
 * @typedef {object} GroupLabels
 * @property {string} id Section element id, also the year-nav anchor.
 * @property {string} heading
 * @property {string} link Year-nav link text.
 * @property {string} noun What the count counts.
 */

// Undated films sit in their own section, always after the dated diary.
const UNDATED = 'earlier';

/**
 * @param {CardData} data
 * @returns {string}
 */
const yearOf = data => data.year || data.date.slice(0, 4);

/** @param {CardData} a @param {CardData} b */
const byTitle = (a, b) => a.title.localeCompare(b.title);

/**
 * Compares two strings in the chosen direction.
 * @param {string} a
 * @param {string} b
 * @param {boolean} oldest
 */
const inOrder = (a, b, oldest) => (oldest ? a.localeCompare(b) : b.localeCompare(a));

/**
 * Within a year, dated items follow the chosen direction and come before undated ones.
 * @param {CardData} a
 * @param {CardData} b
 * @param {boolean} oldest
 * @returns {number}
 */
function compareDates(a, b, oldest) {
  if (a.date && b.date) return inOrder(a.date, b.date, oldest);
  if (!a.date && !b.date) return byTitle(a, b);
  return a.date ? -1 : 1;
}

/**
 * Sort comparator for cards under the `newest` or `oldest` order.
 * @param {CardData} a
 * @param {CardData} b
 * @param {string} order
 * @returns {number}
 */
export function compareCards(a, b, order) {
  // Undated films always stay after the dated diary, even when reversing dates.
  if (a.section !== b.section) return a.section === UNDATED ? 1 : -1;
  if (a.section === UNDATED) return byTitle(a, b);
  const oldest = order === 'oldest';
  return inOrder(yearOf(a), yearOf(b), oldest) || compareDates(a, b, oldest);
}

/**
 * The group a card is shelved under: `earlier` or its year.
 * @param {CardData} data
 * @returns {string}
 */
export const groupKey = data => (data.section === UNDATED ? UNDATED : yearOf(data));

/**
 * Text and anchor for a group's section.
 * @param {string} key From groupKey.
 * @param {string} kind `books` or `movies`.
 * @returns {GroupLabels}
 */
export function groupLabels(key, kind) {
  const books = kind === 'books';
  if (key === UNDATED) {
    return { id: UNDATED, heading: 'Undated', link: 'Undated', noun: books ? 'books' : 'movies' };
  }
  return { id: `y${key}`, heading: key, link: key, noun: books ? 'books' : 'viewings' };
}

/**
 * Groups items in order of first appearance.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * The group key a section id or year-nav hash names.
 * @param {string} id
 * @returns {string}
 */
export const keyFromId = id => (/^y\d{4}$/.test(id) ? id.slice(1) : id);

/**
 * `text` folded for matching: lower case, without accents or apostrophes, other
 * punctuation as spaces.
 * @param {string} text
 * @returns {string}
 */
const fold = text =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether `title` holds every word of `query`, each starting a word of it, ignoring case,
 * accents and punctuation. An empty query matches everything.
 * @param {string} title
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(title, query) {
  const words = ` ${fold(title)}`;
  return fold(query)
    .split(' ')
    .every(word => words.includes(` ${word}`));
}
