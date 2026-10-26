// Pure shelf logic for the books and movies pages: matching, ordering, grouping and
// folding cards by the values in their data-* attributes. Nothing here touches the DOM.
import { fold } from '../lib/collection.js';

export { fold };

/**
 * The data-* values a library card carries.
 * @typedef {object} CardData
 * @property {string} [title]
 * @property {string} [section] `earlier` for undated films.
 * @property {string} [notes] `true` when the item has notes.
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
// Sorting by title shows everything as one group.
const ALL = 'all';
// Years left open when the older ones fold.
const OPEN_YEARS = 2;

/**
 * Whether a card matches a folded search query and the category filter.
 * @param {CardData} data
 * @param {string} query Already folded.
 * @param {string} category `all`, `notes`, or a section name.
 * @returns {boolean}
 */
export function cardMatches(data, query, category) {
  if (!fold(data.title || '').includes(query)) return false;
  if (category === 'all') return true;
  if (category === 'notes') return data.notes === 'true';
  return data.section === category;
}

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
 * Sort comparator for cards under the `newest`, `oldest` or `title` order.
 * @param {CardData} a
 * @param {CardData} b
 * @param {string} order
 * @returns {number}
 */
export function compareCards(a, b, order) {
  // Undated films always stay after the dated diary, even when reversing dates.
  if (a.section !== b.section) return a.section === UNDATED ? 1 : -1;
  if (a.section === UNDATED || order === 'title') return byTitle(a, b);
  const oldest = order === 'oldest';
  return inOrder(yearOf(a), yearOf(b), oldest) || compareDates(a, b, oldest);
}

/**
 * The group a card is shelved under: `earlier`, `all` (title order) or its year.
 * @param {CardData} data
 * @param {string} order
 * @returns {string}
 */
export function groupKey(data, order) {
  if (data.section === UNDATED) return UNDATED;
  if (order === 'title') return ALL;
  return yearOf(data);
}

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
  const noun = books ? 'books' : 'viewings';
  if (key === ALL) {
    const heading = books ? 'The collection' : 'The diary';
    return { id: 'all-items', heading, link: 'The collection', noun };
  }
  return { id: `y${key}`, heading: key, link: key, noun };
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
 * The groups that start folded to a strip: on an unsearched, date-ordered shelf, every
 * group but the most recent years, so the page opens on what came lately.
 * @param {string[]} keys Group keys in page order.
 * @param {string} query Already folded.
 * @param {string} order
 * @returns {Set<string>}
 */
export function foldedGroups(keys, query, order) {
  if (query || order === 'title' || keys.length <= OPEN_YEARS + 1) return new Set();
  const open = keys
    .filter(key => key !== UNDATED)
    .sort()
    .slice(-OPEN_YEARS);
  return new Set(keys.filter(key => !open.includes(key)));
}

/**
 * The group key a section id or year-nav hash names.
 * @param {string} id
 * @returns {string}
 */
export const keyFromId = id => (/^y\d{4}$/.test(id) ? id.slice(1) : id);
