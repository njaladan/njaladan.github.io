// Books and movies pages: search, filter and sort the shelf into year groups, tilt covers
// toward the pointer, and open notes as a book.
import { $, $$ } from './lib/dom.js';
import { installBookDialog } from './library/book.js';
import { installCoverFallbacks, installCoverTilt } from './library/covers.js';
import {
  cardMatches,
  compareCards,
  fold,
  groupBy,
  groupKey,
  groupLabels
} from './library/shelf.js';

/**
 * @typedef {object} Shelf
 * @property {HTMLElement} root
 * @property {string} kind `books` or `movies`.
 * @property {HTMLElement[]} cards
 * @property {HTMLElement} groups
 * @property {HTMLElement} nav Year navigation.
 * @property {HTMLInputElement} search
 * @property {HTMLSelectElement} filter
 * @property {HTMLSelectElement} sort
 */

/**
 * A shelf section with its heading, and the year-nav link to it.
 * @param {string} key
 * @param {HTMLElement[]} items
 * @param {string} kind
 */
function buildGroup(key, items, kind) {
  const labels = groupLabels(key, kind);
  const section = document.createElement('section');
  section.className = 'library-group';
  section.id = labels.id;
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  const title = document.createElement('h2');
  title.textContent = labels.heading;
  heading.append(title);
  if (kind === 'movies') {
    const count = document.createElement('span');
    count.textContent = `${items.length} ${labels.noun}`;
    heading.append(count);
  }
  const shelf = document.createElement('div');
  shelf.className = 'shelf';
  shelf.append(...items);
  section.append(heading, shelf);
  const link = document.createElement('a');
  link.href = `#${section.id}`;
  link.textContent = labels.link;
  return { section, link };
}

/**
 * Cards matching the search and filter, in the chosen order.
 * @param {Shelf} shelf
 */
function visibleCards({ cards, search, filter, sort }) {
  const query = fold(search.value.trim());
  return cards
    .filter(card => cardMatches(card.dataset, query, filter.value))
    .sort((a, b) => compareCards(a.dataset, b.dataset, sort.value));
}

/**
 * Re-shelves the visible cards into groups and rebuilds the year navigation.
 * @param {Shelf} shelf
 */
function update(shelf) {
  const { root, kind, groups, nav, sort } = shelf;
  const visible = visibleCards(shelf);
  const content = document.createDocumentFragment();
  const links = document.createDocumentFragment();
  for (const [key, items] of groupBy(visible, card => groupKey(card.dataset, sort.value))) {
    const { section, link } = buildGroup(key, items, kind);
    content.append(section);
    links.append(link);
  }
  groups.replaceChildren(content);
  nav.replaceChildren(links);
  nav.hidden = !visible.length;
  const empty = $('[data-empty]', root);
  if (empty) empty.hidden = Boolean(visible.length);
  const resultCount = $('[data-count]', root);
  if (resultCount) {
    resultCount.textContent = `${new Set(visible.map(card => card.dataset.filmId)).size} movies`;
  }
}

/**
 * Wires the search, filter and sort controls, when the page has them all.
 * @param {HTMLElement} root
 */
function installShelf(root) {
  const groups = $('[data-groups]', root);
  const nav = $('[data-year-nav]', root);
  const search = /** @type {HTMLInputElement | null} */ ($('[data-search]', root));
  const filter = /** @type {HTMLSelectElement | null} */ ($('[data-filter]', root));
  const sort = /** @type {HTMLSelectElement | null} */ ($('[data-sort]', root));
  const controls = $('.js-controls', root);
  if (!groups || !nav || !search || !filter || !sort || !controls) return;
  controls.hidden = false;
  const cards = $$('.library-card', root);
  /** @type {Shelf} */
  const shelf = { root, kind: root.dataset.library, cards, groups, nav, search, filter, sort };
  const refresh = () => update(shelf);
  search.addEventListener('input', refresh);
  filter.addEventListener('change', refresh);
  sort.addEventListener('change', refresh);
  refresh();
}

function init() {
  const root = $('[data-library]');
  if (!root) return;
  installShelf(root);
  installBookDialog(root);
  installCoverTilt(root);
  installCoverFallbacks(root);
}

init();
