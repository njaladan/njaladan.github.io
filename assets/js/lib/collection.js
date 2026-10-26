// The index bar shared by the collection pages (books, movies, athletics): pill filters,
// a bar pinned to the top of the window, the section in view marked in its links, filters
// kept in the address, and a button back to the top (also on photos).
import { $, $$ } from './dom.js';

// How far below the pinned bar a section's top counts as having reached the top: past the
// gap anchors leave under the bar.
const SPY_SLACK = 64;

// How long the page must stop scrolling before the rail slides to the marked link, in
// milliseconds: years fly past a fast flick, and following each one jerks the rail about.
const REVEAL_DELAY = 150;

/**
 * The query string for `state`, leaving out values at their defaults.
 * @param {Record<string, string>} state
 * @param {Record<string, string>} defaults
 * @returns {string} `''` or `?key=value…`
 */
export function queryFor(state, defaults) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value && value !== defaults[key]) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * The values `search` gives the keys of `defaults`, each falling back to its default.
 * @template {Record<string, string>} T
 * @param {string} search
 * @param {T} defaults
 * @returns {T}
 */
export function readQuery(search, defaults) {
  const params = new URLSearchParams(search);
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, params.get(key) ?? value])
    )
  );
}

/**
 * Shows `state` in the address bar, keeping the hash, without adding to history.
 * @param {Record<string, string>} state
 * @param {Record<string, string>} defaults
 */
export function writeQuery(state, defaults) {
  const url = `${location.pathname}${queryFor(state, defaults)}${location.hash}`;
  history.replaceState(history.state, '', url);
}

/**
 * The last section whose top has scrolled up to `line`; the first until any has, and -1
 * when there are none.
 * @param {number[]} tops Section tops in page order, relative to the window.
 * @param {number} line
 * @returns {number}
 */
export function activeIndex(tops, line) {
  if (!tops.length) return -1;
  let active = 0;
  tops.forEach((top, index) => {
    if (top <= line) active = index;
  });
  return active;
}

/**
 * A row of toggle buttons with one pressed, standing in for a select.
 * @typedef {object} Pills
 * @property {string} value The pressed button's `data-value`.
 * @property {(value: string) => boolean} select Presses the button for `value`; false if none.
 */

/**
 * Wires the `button[data-value]`s in `group` so pressing one calls `onChange` with its value.
 * @param {HTMLElement} group
 * @param {(value: string) => void} onChange
 * @returns {Pills}
 */
export function installPills(group, onChange) {
  const buttons = $$('button[data-value]', group);
  const pressed = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
  /** @type {Pills} */
  const pills = {
    value: (pressed || buttons[0])?.dataset.value ?? '',
    select(value) {
      const match = buttons.find(button => button.dataset.value === value);
      if (!match) return false;
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button === match)));
      pills.value = value;
      return true;
    }
  };
  group.addEventListener('click', event => {
    const button = /** @type {Element} */ (event.target).closest('button[data-value]');
    if (!(button instanceof HTMLElement) || button.dataset.value === pills.value) return;
    pills.select(button.dataset.value);
    onChange(pills.value);
  });
  return pills;
}

/**
 * Keeps `--index-bar-height` at the height the pinned bar covers, so anchors scroll clear
 * of it. On phones only the bar's `.index-rail` is pinned.
 * @param {HTMLElement} bar
 * @returns {() => number} The current height.
 */
export function installIndexBar(bar) {
  let height = 0;
  const measure = () => {
    const pinned = getComputedStyle(bar).display === 'contents' ? $('.index-rail', bar) : bar;
    height = pinned?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--index-bar-height', `${height}px`);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(bar);
  const rail = $('.index-rail', bar);
  if (rail) observer.observe(rail);
  measure();
  return () => height;
}

/**
 * Scrolls `link` into view along `nav` when the links overflow it.
 * @param {HTMLElement} nav Positioned, so it is its links' offset parent.
 * @param {HTMLElement} link
 */
function revealLink(nav, link) {
  const left = link.offsetLeft;
  const right = left + link.offsetWidth;
  if (left >= nav.scrollLeft && right <= nav.scrollLeft + nav.clientWidth) return;
  nav.scrollTo({ left: left - (nav.clientWidth - link.offsetWidth) / 2, behavior: 'smooth' });
}

/**
 * Marks the link in `nav` to the section at the top of the window with `aria-current`.
 * @param {HTMLElement} nav Links to sections on the page by `#id`.
 * @param {() => number} offset How much of the window the pinned bar covers.
 * @returns {() => void} Re-marks the links, for after they or the sections change.
 */
export function installScrollSpy(nav, offset) {
  let frame = 0;
  let reveal = 0;
  const mark = () => {
    frame = 0;
    /** @type {HTMLAnchorElement[]} */
    const links = $$('a[href^="#"]', nav);
    const tops = links.map(
      link => document.getElementById(link.hash.slice(1))?.getBoundingClientRect().top ?? Infinity
    );
    const active = activeIndex(tops, offset() + SPY_SLACK);
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    clearTimeout(reveal);
    const link = links[active];
    if (link) reveal = setTimeout(() => revealLink(nav, link), REVEAL_DELAY);
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(mark);
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  schedule();
  return schedule;
}

/** A button back to the top that appears once the page has scrolled well down. */
export function installBackToTop() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-to-top';
  button.setAttribute('aria-label', 'Back to top');
  button.textContent = '↑';
  button.hidden = true;
  button.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.append(button);
  const toggle = () => {
    button.hidden = scrollY < innerHeight * 1.5;
  };
  addEventListener('scroll', toggle, { passive: true });
  toggle();
}
