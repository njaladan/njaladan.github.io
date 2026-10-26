// Books and movies pages: search, filter and sort the shelf into year groups, fold older
// years to a strip, mark the year in view, tilt covers toward the pointer, and open notes
// as a book.
import { $, $$ } from './lib/dom.js';
import {
  installBackToTop,
  installIndexBar,
  installPills,
  installScrollSpy,
  installSearchKey,
  readQuery,
  writeQuery
} from './lib/collection.js';
import { installBookDialog } from './library/book.js';
import { installCoverFallbacks, installCoverTilt } from './library/covers.js';
import {
  cardMatches,
  compareCards,
  fold,
  foldedGroups,
  groupBy,
  groupKey,
  groupLabels,
  keyFromId
} from './library/shelf.js';

/** @typedef {import('./lib/collection.js').Pills} Pills */

/**
 * @typedef {object} Shelf
 * @property {HTMLElement} root
 * @property {string} kind `books` or `movies`.
 * @property {HTMLElement[]} cards The shelved cards, not the recent strip's copies.
 * @property {HTMLElement} groups
 * @property {HTMLElement} nav Year navigation.
 * @property {HTMLInputElement} search
 * @property {Pills} filter
 * @property {Pills} sort
 * @property {Record<string, string>} defaults The filters' values with nothing chosen.
 * @property {boolean} folds Whether older years fold to a strip.
 * @property {Set<string>} opened Folding groups the reader has opened.
 * @property {HTMLElement | null} recent
 * @property {() => void} spy Re-marks the year in view.
 */

// The fewest covers a folded strip shows, on phones; smaller years need no tile to open.
const STRIP = 5;
// Cards in the recent strip above the shelf.
const RECENT = 8;

/** @param {Shelf} shelf */
const currentQuery = shelf => ({
  q: shelf.search.value.trim(),
  show: shelf.filter.value,
  sort: shelf.sort.value
});

/**
 * Folds `section` to a strip of its first covers, or opens it.
 * @param {HTMLElement} section
 * @param {boolean} folded
 */
function setFolded(section, folded) {
  const shelf = $('.shelf', section);
  const toggle = $('[data-fold-toggle]', section);
  const total = Number(section.dataset.total);
  const label = $('h2', section)?.textContent;
  section.classList.toggle('is-folded', folded);
  if (toggle) {
    toggle.textContent = folded ? `Show all ${total}` : 'Show fewer';
    toggle.setAttribute('aria-expanded', String(!folded));
  }
  $('.fold-more', section)?.remove();
  if (folded && shelf && total > STRIP) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'fold-more';
    more.dataset.foldToggle = '';
    more.setAttribute('aria-label', `Show all ${total} from ${label}`);
    more.textContent = `All ${total}`;
    shelf.append(more);
  }
}

/**
 * A shelf section with its heading, and the year-nav link to it.
 * @param {string} key
 * @param {HTMLElement[]} items
 * @param {string} kind
 * @param {boolean | null} folded Whether it is folded, or null when it never folds.
 */
function buildGroup(key, items, kind, folded) {
  const labels = groupLabels(key, kind);
  const section = document.createElement('section');
  section.className = 'library-group';
  section.id = labels.id;
  section.dataset.key = key;
  section.dataset.total = String(items.length);
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
  if (folded !== null) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fold-toggle';
    toggle.dataset.foldToggle = '';
    heading.append(toggle);
    setFolded(section, folded);
  }
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
  const { root, kind, groups, nav, sort, search, recent } = shelf;
  const visible = visibleCards(shelf);
  const grouped = groupBy(visible, card => groupKey(card.dataset, sort.value));
  const query = fold(search.value.trim());
  const folded = shelf.folds ? foldedGroups([...grouped.keys()], query, sort.value) : null;
  const content = document.createDocumentFragment();
  const links = document.createDocumentFragment();
  for (const [key, items] of grouped) {
    const state = folded?.has(key) ? !shelf.opened.has(key) : null;
    const { section, link } = buildGroup(key, items, kind, state);
    content.append(section);
    links.append(link);
  }
  groups.replaceChildren(content);
  nav.replaceChildren(links);
  nav.hidden = !visible.length;
  if (recent) recent.hidden = Boolean(query) || !recent.childElementCount;
  const empty = $('[data-empty]', root);
  if (empty) empty.hidden = Boolean(visible.length);
  const resultCount = $('[data-count]', root);
  if (resultCount) {
    const count = new Set(visible.map(card => card.dataset.filmId || card)).size;
    resultCount.textContent = `${count} ${kind === 'books' ? 'books' : 'movies'}`;
  }
  writeQuery(currentQuery(shelf), shelf.defaults);
  shelf.spy();
}

/**
 * Opens the folded group with section id `id`, if there is one.
 * @param {Shelf} shelf
 * @param {string} id
 */
function openGroup(shelf, id) {
  const section = document.getElementById(id);
  shelf.opened.add(keyFromId(id));
  if (section?.classList.contains('is-folded')) setFolded(section, false);
}

/**
 * Opening and closing folded groups: their toggles, their covers and the year links.
 * @param {Shelf} shelf
 */
function installFolding(shelf) {
  const { groups, nav } = shelf;
  groups.addEventListener('click', event => {
    const target = /** @type {Element} */ (event.target);
    const section = target.closest('.library-group');
    if (!(section instanceof HTMLElement)) return;
    const toggle = target.closest('[data-fold-toggle]');
    const folded = section.classList.contains('is-folded');
    if (!toggle && !(folded && target.closest('.library-card'))) return;
    event.preventDefault();
    const key = section.dataset.key;
    if (folded) shelf.opened.add(key);
    else shelf.opened.delete(key);
    setFolded(section, !folded);
    // Folding a long year from inside it would leave the reader somewhere further down.
    if (!folded && section.getBoundingClientRect().top < 0) section.scrollIntoView();
  });
  nav.addEventListener('click', event => {
    const link = /** @type {Element} */ (event.target).closest('a[href^="#"]');
    if (link instanceof HTMLAnchorElement) openGroup(shelf, link.hash.slice(1));
  });
}

/**
 * Copies the most recent dated cards into the strip above the shelf.
 * @param {HTMLElement[]} cards
 * @param {HTMLElement} strip
 */
function fillRecent(cards, strip) {
  const seen = new Set();
  const latest = cards
    .filter(card => card.dataset.section !== 'earlier' && card.dataset.date)
    .sort((a, b) => compareCards(a.dataset, b.dataset, 'newest'))
    .filter(card => {
      const id = card.dataset.filmId || card.dataset.title;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, RECENT);
  strip.replaceChildren(
    ...latest.map(card => {
      const copy = /** @type {HTMLElement} */ (card.cloneNode(true));
      copy.classList.add('recent-card');
      return copy;
    })
  );
}

/**
 * Wires the search, filter and sort controls, when the page has them all.
 * @param {HTMLElement} root
 */
function installShelf(root) {
  const groups = $('[data-groups]', root);
  const nav = $('[data-year-nav]', root);
  const bar = $('[data-index-bar]', root);
  const search = /** @type {HTMLInputElement | null} */ ($('[data-search]', root));
  const filterGroup = $('[data-filter]', root);
  const sortGroup = $('[data-sort]', root);
  const controls = $('.js-controls', root);
  if (!groups || !nav || !bar || !search || !filterGroup || !sortGroup || !controls) return;
  controls.hidden = false;
  const cards = $$('.library-card', groups);
  const recentSection = $('[data-recent]', root);
  const recent = recentSection && $('.recent-shelf', recentSection);
  if (recent) fillRecent(cards, recent);
  const height = installIndexBar(bar);
  /** @type {Shelf} */
  const shelf = {
    root,
    kind: root.dataset.library,
    cards,
    groups,
    nav,
    search,
    filter: installPills(filterGroup, () => update(shelf)),
    sort: installPills(sortGroup, () => update(shelf)),
    defaults: {},
    folds: 'fold' in root.dataset,
    opened: new Set(),
    recent: recentSection,
    spy: installScrollSpy(nav, height)
  };
  shelf.defaults = { q: '', show: shelf.filter.value, sort: shelf.sort.value };
  const chosen = readQuery(location.search, shelf.defaults);
  search.value = chosen.q;
  shelf.filter.select(chosen.show);
  shelf.sort.select(chosen.sort);
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) shelf.opened.add(keyFromId(hash));
  search.addEventListener('input', () => update(shelf));
  installFolding(shelf);
  installSearchKey(search);
  update(shelf);
  // The groups were rebuilt, so an anchor in the address needs scrolling to again, once
  // the browser has made its own attempt.
  const target = hash && document.getElementById(hash);
  const jump = () => target?.scrollIntoView({ behavior: 'instant' });
  if (target) addEventListener('load', jump, { once: true });
}

function init() {
  const root = $('[data-library]');
  if (!root) return;
  installShelf(root);
  installBackToTop();
  installBookDialog(root);
  installCoverTilt(root);
  installCoverFallbacks(root);
}

init();
