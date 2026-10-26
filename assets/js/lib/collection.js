// The index bar shared by the collection pages (books, movies, athletics): pill filters,
// a bar pinned to the top of the window, the section in view marked in its links, filters
// kept in the address, and a button back to the top (also on photos).
import { $, $$ } from './dom.js';

// How far a section's top may sit below where scrolling to it lands (the page's scroll
// padding) and still count as having reached the top, for rounding.
const SPY_SLACK = 2;

// The rail's highlight glides from each year to the next, steadily, over the scrolling up
// to where the next year's top reaches the bar, or over at most this many pixels of it,
// so in a long year it rests until the next comes near.
const GLIDE_PX = 240;
// While it moves, it draws out a tail behind it: this many milliseconds of its travel at
// its current speed, up to this many pixels. Its speed is smoothed by this share each frame.
const TAIL_MS = 45;
const TAIL_MAX = 90;
const SPEED_SMOOTHING = 0.35;
// Once the page has been still this long, in milliseconds, the highlight settles onto the
// marked year, so it never rests stretched or between two, and when the scrolling picks up
// again it eases back into its glide. Either way it closes the gap by about two thirds every
// this many milliseconds, from wherever it is, so a change of year midway can't make it jump.
const SETTLE_DELAY = 120;
const SETTLE_MS = 70;
// The longest frame the settling counts, so the first frame after a pause eases too.
const SETTLE_FRAME_MS = 20;

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
 * @typedef {object} RailStop Where the rail's highlight lies at one scroll position.
 * @property {number} y The window's scroll position.
 * @property {number} left Its edges, along the rail.
 * @property {number} right
 */

/**
 * The highlight's path along the rail as the page scrolls: resting on each link where its
 * section reaches the bar, and gliding steadily to the next on the way to where that one's
 * does. Moves past the end of the page's scroll are left out, as they can't be reached.
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
    const from = Math.max(at - GLIDE_PX, starts[index - 1], stops[stops.length - 1].y);
    stops.push({ y: from, ...links[index - 1] }, { y: Math.max(at, from), ...links[index] });
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
 * How the highlight moves from frame to frame: gliding along with the scroll, drawing out
 * a tail behind it the faster it goes, and once the page is still, settling onto the
 * marked link, so it never rests stretched or between two.
 */
export function createMotion() {
  // The glide's centre and smoothed speed along the rail, in pixels per millisecond.
  let last = { centre: NaN, time: 0 };
  let speed = 0;
  // How far its edges sit from the glide, settling onto the marked link. It starts settled.
  let shift = /** @type {{left: number, right: number} | null} */ (null);
  return {
    /** Forgets the last frame, for after the rail or the page are re-measured. */
    reset() {
      last = { centre: NaN, time: 0 };
    },
    /**
     * The highlight's edges this frame, and whether it is still on the move.
     * @param {{left: number, right: number}} glide Where the scroll puts it.
     * @param {{left: number, right: number}} rest The marked link.
     * @param {number} time
     * @param {boolean} still Whether the page has stopped scrolling.
     */
    at(glide, rest, time, still) {
      const centre = (glide.left + glide.right) / 2;
      const elapsed = Math.max(time - last.time, 1);
      const moved = Number.isNaN(last.centre) ? 0 : centre - last.centre;
      speed += (moved / elapsed - speed) * SPEED_SMOOTHING;
      last = { centre, time };
      const target = still
        ? { left: rest.left - glide.left, right: rest.right - glide.right }
        : { left: 0, right: 0 };
      shift ??= target;
      const ease = 1 - Math.exp(-Math.min(elapsed, SETTLE_FRAME_MS) / SETTLE_MS);
      shift = {
        left: shift.left + (target.left - shift.left) * ease,
        right: shift.right + (target.right - shift.right) * ease
      };
      // Draws back in on its own as the glide slows.
      const tail = Math.min(Math.abs(speed) * TAIL_MS, TAIL_MAX);
      const off = Math.max(
        Math.abs(target.left - shift.left),
        Math.abs(target.right - shift.right)
      );
      const moving = !still || off > 0.3 || tail > 0.3;
      if (!moving) {
        shift = target;
        speed = 0;
      }
      return {
        left: glide.left + shift.left - (speed > 0 ? tail : 0),
        right: glide.right + shift.right + (speed < 0 ? tail : 0),
        moving
      };
    }
  };
}

/**
 * Marks the link in `nav` to the section at the top of the window with `aria-current`, and
 * moves a highlight along with the scroll to it: gliding from one link to the next as their
 * sections pass, drawing out a tail behind it the faster it goes, and kept in the middle of
 * the rail when the links overflow it.
 * @param {HTMLElement} nav Links to sections on the page by `#id`; positioned, so it is
 *   their offset parent.
 * @param {() => number} offset How much of the window the pinned bar covers, for when the
 *   page sets no scroll padding.
 * @returns {() => void} Re-measures, for after the links or the sections change.
 */
export function installScrollSpy(nav, offset) {
  const { marker, parts } = createMarker();
  /** @type {RailStop[]} */
  let stops = [];
  /** @type {{left: number, right: number}[]} */
  let rests = [];
  /** @type {number[]} */
  let starts = [];
  /** @type {HTMLAnchorElement[]} */
  let links = [];
  /** @type {HTMLAnchorElement | undefined} */
  let current;
  let height = 0;
  let frame = 0;
  let stale = true;
  // When the page last scrolled.
  let scrolled = -Infinity;
  const motion = createMotion();

  const measure = () => {
    stale = false;
    motion.reset();
    links = $$('a[href^="#"]', nav);
    // The links can be rebuilt, taking the marker with them. It goes over them, turning
    // what it covers light.
    if (!marker.isConnected) nav.append(marker);
    marker.hidden = !links.length;
    if (!links.length) return;
    // Where scrolling to a section lands, so one scrolled to by its link has the highlight
    // resting on it.
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    const line = (Number.isFinite(padding) && padding > 0 ? padding : offset()) + SPY_SLACK;
    starts = links.map(link => {
      const section = document.getElementById(link.hash.slice(1));
      return section ? section.getBoundingClientRect().top + scrollY - line : Infinity;
    });
    rests = links.map(link => ({
      left: link.offsetLeft,
      right: link.offsetLeft + link.offsetWidth
    }));
    stops = railTrack(starts, rests, document.documentElement.scrollHeight - innerHeight);
    height = links[0].offsetHeight;
    marker.style.top = `${links[0].offsetTop}px`;
    marker.style.setProperty('--marker-size', `${height}px`);
  };

  /** @param {number} time */
  const update = time => {
    frame = 0;
    if (stale) measure();
    if (!links.length) return;
    const y = scrollY;
    const active = activeIndex(starts, y);
    const still = time - scrolled >= SETTLE_DELAY;
    const { left, right, moving } = motion.at(railAt(stops, y), rests[active], time, still);
    markerPose({ left, right }, height).forEach((transform, index) => {
      parts[index].style.transform = transform;
    });
    if (nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = (left + right) / 2 - nav.clientWidth / 2;
    }
    // Carries on after the scrolling stops, until the highlight has settled.
    if (moving) frame ||= requestAnimationFrame(update);
    const link = links[active];
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
  addEventListener(
    'scroll',
    () => {
      scrolled = performance.now();
      schedule();
    },
    { passive: true }
  );
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
