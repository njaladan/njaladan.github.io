// The index bar shared by the collection pages (books, movies, athletics): pill filters,
// a bar pinned to the top of the window, the section in view marked in its links, filters
// kept in the address, and a button back to the top (also on photos).
import { $, $$ } from './dom.js';

// How far below the pinned bar a section's top counts as having reached the top: past the
// gap anchors leave under the bar.
const SPY_SLACK = 64;

// The rail's highlight follows the page's scroll: it holds on a year, and as the next
// year's top comes up to the bar it stretches across, its leading edge going first and its
// trailing edge catching up, over at most this many pixels of scrolling, and at most half
// the way from the year before, so even close years have it resting a while. It arrives as the year does, so a year scrolled to by
// its link has it resting there.
const STRETCH_PX = 160;
// How far along the move each edge starts or finishes its part.
const STRETCH_LAG = 0.4;
// Points sampled along each move.
const STRETCH_STEPS = 8;

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

/** @param {number} t */
const smooth = t => t * t * (3 - 2 * t);

/**
 * @typedef {object} RailStop Where the rail's highlight lies at one scroll position.
 * @property {number} y The window's scroll position.
 * @property {number} left Its edges, along the rail.
 * @property {number} right
 */

/**
 * The highlight's path along the rail as the page scrolls: holding on each link, and
 * stretching from one to the next over the scrolling up to where the next one's section
 * reaches the bar. Moves past the end of the page's scroll are left out, as they can't be
 * reached.
 * @param {number[]} starts The scroll position where each link's section reaches the bar.
 * @param {{left: number, right: number}[]} links The links' edges along the rail.
 * @param {number} end The furthest the page scrolls.
 * @returns {RailStop[]} In scroll order, starting on the first link.
 */
export function railTrack(starts, links, end) {
  if (!links.length) return [];
  /** @type {RailStop[]} */
  const stops = [{ y: -Infinity, ...links[0] }];
  for (let index = 1; index < links.length; index++) {
    const at = starts[index];
    if (!(at <= end)) break;
    const room = Math.min(at - starts[index - 1], (starts[index + 1] ?? Infinity) - at);
    const span = Math.max(Math.min(STRETCH_PX, room / 2), 0);
    const from = links[index - 1];
    const to = links[index];
    for (let step = 0; step <= STRETCH_STEPS; step++) {
      const t = step / STRETCH_STEPS;
      const lead = smooth(Math.min(t / (1 - STRETCH_LAG), 1));
      const trail = smooth(Math.max(t - STRETCH_LAG, 0) / (1 - STRETCH_LAG));
      const [left, right] = to.left >= from.left ? [trail, lead] : [lead, trail];
      stops.push({
        y: Math.max(at - span + t * span, stops[stops.length - 1].y),
        left: from.left + (to.left - from.left) * left,
        right: from.right + (to.right - from.right) * right
      });
    }
  }
  return stops;
}

/**
 * Where the highlight lies at scroll position `y`.
 * @param {RailStop[]} stops
 * @param {number} y
 * @returns {{left: number, right: number}}
 */
export function railAt(stops, y) {
  let low = 0;
  let high = stops.length - 1;
  if (y >= stops[high].y) return { left: stops[high].left, right: stops[high].right };
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (stops[middle].y <= y) low = middle;
    else high = middle;
  }
  const [a, b] = [stops[low], stops[high]];
  if (a.y === -Infinity) return { left: a.left, right: a.right };
  const t = b.y > a.y ? (y - a.y) / (b.y - a.y) : 1;
  return { left: a.left + (b.left - a.left) * t, right: a.right + (b.right - a.right) * t };
}

/**
 * The rail's highlight, drawn as two round ends and a bar between them so the ends stay
 * round however far it stretches: the ends only slide, and only the bar is drawn out.
 */
function createMarker() {
  const marker = document.createElement('span');
  marker.className = 'rail-marker';
  marker.setAttribute('aria-hidden', 'true');
  const parts = ['cap', 'bar', 'cap'].map(name => {
    const part = document.createElement('span');
    part.className = `rail-marker-${name}`;
    return part;
  });
  marker.append(...parts);
  return { marker, parts };
}

/**
 * The transforms of the highlight's left end, bar and right end between `edges`, for ends
 * `size` across. The bar runs between the ends' centres, under them.
 * @param {{left: number, right: number}} edges
 * @param {number} size
 * @returns {string[]}
 */
function markerPose({ left, right }, size) {
  return [
    `translateX(${left}px)`,
    `translateX(${left + size / 2}px) scaleX(${Math.max(right - left - size, 0)})`,
    `translateX(${right - size}px)`
  ];
}

/**
 * Marks the link in `nav` to the section at the top of the window with `aria-current`, and
 * moves a highlight along with the scroll to it: stretching from one link to the next as
 * their sections pass, and kept in the middle of the rail when the links overflow it.
 * Where the browser can, it ties the highlight to the scroll itself, so it moves in step
 * with the page rather than a frame behind.
 * @param {HTMLElement} nav Links to sections on the page by `#id`; positioned, so it is
 *   their offset parent.
 * @param {() => number} offset How much of the window the pinned bar covers.
 * @returns {() => void} Re-measures, for after the links or the sections change.
 */
export function installScrollSpy(nav, offset) {
  const { marker, parts } = createMarker();
  const scrollDriven = 'ScrollTimeline' in window;
  /** @type {RailStop[]} */
  let stops = [];
  /** @type {number[]} */
  let starts = [];
  /** @type {HTMLAnchorElement[]} */
  let links = [];
  /** @type {HTMLAnchorElement | undefined} */
  let current;
  let height = 0;
  let frame = 0;
  let stale = true;
  /** @param {{left: number, right: number}} edges */
  const pose = edges => markerPose(edges, height);

  const measure = () => {
    stale = false;
    links = $$('a[href^="#"]', nav);
    // The links can be rebuilt, taking the marker with them. It goes over them, turning
    // what it covers light.
    if (!marker.isConnected) nav.append(marker);
    marker.hidden = !links.length;
    marker.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    if (!links.length) return;
    const line = offset() + SPY_SLACK;
    starts = links.map(link => {
      const section = document.getElementById(link.hash.slice(1));
      return section ? section.getBoundingClientRect().top + scrollY - line : Infinity;
    });
    const end = document.documentElement.scrollHeight - innerHeight;
    stops = railTrack(
      starts,
      links.map(link => ({ left: link.offsetLeft, right: link.offsetLeft + link.offsetWidth })),
      end
    );
    height = links[0].offsetHeight;
    marker.style.top = `${links[0].offsetTop}px`;
    marker.style.setProperty('--marker-size', `${height}px`);
    if (!scrollDriven || end <= 0) return;
    // Scroll progress runs from 0 to 1 over the page's whole scroll.
    const offsets = [...stops.map(stop => Math.min(Math.max(stop.y / end, 0), 1)), 1];
    const poses = [...stops, stops[stops.length - 1]].map(pose);
    const source = document.scrollingElement ?? document.documentElement;
    const timeline = new ScrollTimeline({ source, axis: 'block' });
    parts.forEach((part, index) => {
      const frames = poses.map((transforms, step) => ({
        offset: offsets[step],
        transform: transforms[index]
      }));
      part.animate(frames, { timeline, fill: 'both' });
    });
  };

  const update = () => {
    frame = 0;
    if (stale) measure();
    if (!links.length) return;
    const y = scrollY;
    const edges = railAt(stops, y);
    if (!scrollDriven) {
      pose(edges).forEach((transform, index) => (parts[index].style.transform = transform));
    }
    if (nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = (edges.left + edges.right) / 2 - nav.clientWidth / 2;
    }
    const link = links[activeIndex(starts, y)];
    // Left alone while it stays put, so a scroll within a year touches nothing.
    if (link === current) return;
    current?.removeAttribute('aria-current');
    link.setAttribute('aria-current', 'location');
    current = link;
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(update);
  };
  const remeasure = () => {
    stale = true;
    schedule();
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', remeasure);
  // Years opening and folding, covers loading and fonts arriving all move the sections.
  new ResizeObserver(remeasure).observe(document.body);
  remeasure();
  return remeasure;
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
