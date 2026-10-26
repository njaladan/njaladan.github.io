// Books and movies pages: shelve the cards into year groups, fold older years to a strip,
// mark the year in view, tilt covers toward the pointer, and open notes as a book.
import { $, $$ } from './lib/dom.js';
import { installBackToTop, installIndexBar, installScrollSpy } from './lib/collection.js';
import { installBookDialog } from './library/book.js';
import { installCoverFallbacks, installCoverTilt } from './library/covers.js';
import {
  compareCards,
  foldedGroups,
  groupBy,
  groupKey,
  groupLabels,
  keyFromId
} from './library/shelf.js';

/**
 * @typedef {object} Shelf
 * @property {string} kind `books` or `movies`.
 * @property {HTMLElement[]} cards
 * @property {HTMLElement} groups
 * @property {HTMLElement} nav Year navigation.
 * @property {boolean} folds Whether older years fold to a strip.
 * @property {Set<string>} opened Folding groups the reader has opened.
 * @property {() => void} spy Re-marks the year in view.
 */

// The fewest covers a folded strip shows, on phones; smaller years need no tile to open.
const STRIP = 5;
// Movies read newest first, books oldest first.
const ORDER = { movies: 'newest', books: 'oldest' };

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
 * Shelves the cards into groups and builds the year navigation.
 * @param {Shelf} shelf
 */
function update(shelf) {
  const { kind, cards, groups, nav } = shelf;
  const order = ORDER[kind] || 'oldest';
  const sorted = [...cards].sort((a, b) => compareCards(a.dataset, b.dataset, order));
  const grouped = groupBy(sorted, card => groupKey(card.dataset));
  const folded = shelf.folds ? foldedGroups([...grouped.keys()]) : null;
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
 * Shelves the cards and wires the index bar and folding, when the page has them.
 * @param {HTMLElement} root
 */
function installShelf(root) {
  const groups = $('[data-groups]', root);
  const nav = $('[data-year-nav]', root);
  const bar = $('[data-index-bar]', root);
  if (!groups || !nav || !bar) return;
  /** @type {Shelf} */
  const shelf = {
    kind: root.dataset.library,
    cards: $$('.library-card', groups),
    groups,
    nav,
    folds: 'fold' in root.dataset,
    opened: new Set(),
    spy: installScrollSpy(nav, installIndexBar(bar))
  };
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) shelf.opened.add(keyFromId(hash));
  installFolding(shelf);
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
