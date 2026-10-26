// Books and movies pages: shelve the cards into year groups, fold movie years to a strip,
// mark the year in view, tilt covers toward the pointer, and open notes as a book.
import { $, $$ } from './lib/dom.js';
import { installBackToTop, installIndexBar, installScrollSpy } from './lib/collection.js';
import { installBookDialog } from './library/book.js';
import { installCoverFallbacks, installCoverTilt, reducedMotion } from './library/covers.js';
import { compareCards, groupBy, groupKey, groupLabels, keyFromId } from './library/shelf.js';

/**
 * @typedef {object} Shelf
 * @property {string} kind `books` or `movies`.
 * @property {HTMLElement[]} cards
 * @property {HTMLElement} groups
 * @property {HTMLElement} nav Year navigation.
 * @property {boolean} folds Whether years start folded to a strip.
 * @property {Set<string>} opened Folding groups the reader has opened.
 * @property {() => void} spy Re-marks the year in view.
 */

// The fewest covers a folded strip shows, on phones; smaller years need no tile to open.
const STRIP = 5;
// Movies read newest first, books oldest first.
const ORDER = { movies: 'newest', books: 'oldest' };
// How long a year takes to open or fold, in milliseconds.
const FOLD_MS = 420;
const FOLD_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// How long what a fold hides takes to fade out before the covers move.
const FADE_MS = 160;

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
 * Where `element` is drawn, relative to `origin`.
 * @param {Element} element
 * @param {DOMRect} origin
 */
function placeIn(element, origin) {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left: left - origin.left, top: top - origin.top, width, height };
}

/**
 * Fades out what folding `section` will hide: the titles and the covers past the strip.
 * @param {HTMLElement} section
 */
function fadeHidden(section) {
  section.classList.add('is-folded');
  const hidden = $$('.library-card', section).filter(card => !card.offsetWidth);
  section.classList.remove('is-folded');
  const fading = [...hidden, ...$$('.card-title', section)].map(element =>
    element.animate(
      { opacity: [1, 0] },
      { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' }
    )
  );
  return Promise.all(fading.map(animation => animation.finished)).catch(() => {});
}

/**
 * Runs `change` on `section`, then eases it there: the height follows, covers on show
 * before and after slide and grow from where they were, and the rest fade in. A fold first
 * fades out what it will hide, so nothing vanishes from under the moving covers.
 * @param {HTMLElement} section
 * @param {() => void} change
 * @param {boolean} folding
 */
async function animateFold(section, change, folding) {
  if (reducedMotion()) {
    section.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    change();
    return;
  }
  if (folding) {
    section.dataset.fading = '';
    await fadeHidden(section);
    // Jumping to another year in the meantime settles this one.
    if (!('fading' in section.dataset)) return;
    delete section.dataset.fading;
  }
  const running = section.getAnimations({ subtree: true });
  // Measured before cancelling, so a fold reversed midway starts from where it got to.
  const from = section.getBoundingClientRect();
  const covers = $$('.cover, .fold-more', section);
  const before = new Map(covers.map(cover => [cover, placeIn(cover, from)]));
  running.forEach(animation => animation.cancel());
  change();
  const to = section.getBoundingClientRect();
  const timing = { duration: FOLD_MS, easing: FOLD_EASE };
  section.classList.add('folding');
  const height = section.animate({ height: [`${from.height}px`, `${to.height}px`] }, timing);
  height.onfinish = height.oncancel = () => section.classList.remove('folding');
  for (const cover of $$('.cover, .fold-more', section)) {
    const now = placeIn(cover, to);
    const was = before.get(cover);
    if (!now.width) continue;
    if (was?.width) {
      const shift = `translate(${was.left - now.left}px, ${was.top - now.top}px)`;
      const scale = `scale(${was.width / now.width}, ${was.height / now.height})`;
      cover.animate(
        { transform: [`${shift} ${scale}`, 'none'], transformOrigin: ['0 0', '0 0'] },
        timing
      );
    } else {
      cover.animate({ opacity: [0, 1] }, { ...timing, delay: FOLD_MS / 3, fill: 'backwards' });
    }
  }
  if (!section.classList.contains('is-folded')) {
    for (const title of $$('.card-title', section)) {
      title.animate({ opacity: [0, 1] }, { ...timing, delay: FOLD_MS / 2, fill: 'backwards' });
    }
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
  const content = document.createDocumentFragment();
  const links = document.createDocumentFragment();
  for (const [key, items] of grouped) {
    const state = shelf.folds ? !shelf.opened.has(key) : null;
    const { section, link } = buildGroup(key, items, kind, state);
    content.append(section);
    links.append(link);
  }
  groups.replaceChildren(content);
  nav.replaceChildren(links);
  shelf.spy();
}

/**
 * Opens the folded group with section id `id`, if there is one, and folds the rest.
 * @param {Shelf} shelf
 * @param {string} id
 */
function openGroup(shelf, id) {
  if (!document.getElementById(id)) return;
  shelf.opened = new Set([keyFromId(id)]);
  for (const section of $$('.library-group', shelf.groups)) {
    section.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    delete section.dataset.fading;
    const folded = section.id !== id;
    if (section.classList.contains('is-folded') !== folded) setFolded(section, folded);
  }
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
    if ('fading' in section.dataset) return;
    const key = section.dataset.key;
    if (folded) shelf.opened.add(key);
    else shelf.opened.delete(key);
    // Folding a long year from inside it would leave the reader somewhere further down.
    if (!folded && section.getBoundingClientRect().top < 0) {
      section.scrollIntoView({ behavior: 'instant' });
    }
    animateFold(section, () => setFolded(section, !folded), !folded);
  });
  nav.addEventListener('click', event => {
    const link = /** @type {Element} */ (event.target).closest('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const section = document.getElementById(link.hash.slice(1));
    if (!section) return;
    // Scrolled here rather than by the link: folding the years above would otherwise pull
    // the page under the browser's own scroll to the anchor.
    event.preventDefault();
    openGroup(shelf, section.id);
    history.pushState(history.state, '', link.hash);
    section.scrollIntoView();
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
  // The movies page arrives shelved and folded, so it loads as it will look; the books
  // page is shelved here.
  if (shelf.folds && $('.library-group[data-key]', groups)) {
    if (hash) openGroup(shelf, hash);
    shelf.spy();
  } else update(shelf);
  // The groups changed, so an anchor in the address needs scrolling to again, once the
  // browser has made its own attempt.
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
