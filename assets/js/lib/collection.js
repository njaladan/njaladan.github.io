// The index bar shared by the collection pages (books, movies, athletics): pill filters,
// a bar pinned to the top of the window, the section in view marked in its links, filters
// kept in the address, and a button back to the top (also on photos).
import { $, $$ } from './dom.js';

// How far below the pinned bar a section's top counts as having reached the top: past the
// gap anchors leave under the bar.
const SPY_SLACK = 64;

// The rail's highlight moves on two springs, one for each edge. The edge in front is stiffer
// than the one behind, so the highlight stretches as it goes, the more the faster it moves,
// and gathers itself up when it arrives. Stiffness is per second squared; each spring is
// critically damped, so it settles without overshooting.
const LEAD_STIFFNESS = 520;
const TRAIL_STIFFNESS = 150;
// The springs are worked out ahead in steps of this many seconds and handed to the browser
// as keyframes, so it can run them off the main thread.
const SPRING_STEP = 1 / 60;
// Close enough to rest, in pixels and pixels per second, and the longest a move may take.
const REST_PX = 0.3;
const REST_SPEED = 4;
const SPRING_MAX_STEPS = 90;
// How close the highlight's leading edge may come to the end of the rail before the rail
// scrolls along with it, in pixels.
const FOLLOW_MARGIN = 56;

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
 * An edge's path on a spring toward `target`, from where it is and how fast it is moving.
 * @param {{x: number, v: number}} edge
 * @param {number} target
 * @param {number} stiffness
 * @returns {{x: number, v: number}[]} Its state at each step, ending at rest on `target`.
 */
function springPath(edge, target, stiffness) {
  const damping = 2 * Math.sqrt(stiffness);
  let { x, v } = edge;
  const path = [{ x, v }];
  for (let step = 0; step < SPRING_MAX_STEPS; step++) {
    if (Math.abs(target - x) < REST_PX && Math.abs(v) < REST_SPEED) break;
    // Semi-implicit Euler: steady at these stiffnesses and step.
    v += (stiffness * (target - x) - damping * v) * SPRING_STEP;
    x += v * SPRING_STEP;
    path.push({ x, v });
  }
  path.push({ x: target, v: 0 });
  return path;
}

/**
 * A highlight for `nav` that springs to the link it is given, stretching while it moves.
 * A new link mid-move carries on from where the edges are and how fast they are going.
 * It jumps rather than travels into its first place, and back after hiding. When the links
 * overflow `nav`, it scrolls along with the highlight's leading edge.
 * @param {HTMLElement} nav Positioned, so it is its links' offset parent.
 * @param {HTMLElement} nav
 * @returns {(link: HTMLElement | undefined) => void}
 */
function createMarker(nav) {
  const marker = document.createElement('span');
  marker.className = 'rail-marker';
  marker.setAttribute('aria-hidden', 'true');
  /** @type {{left: number, right: number, top: number, width: number} | null} */
  let to = null;
  /** @type {{x: number, v: number}[][]} The left and right edges' paths. */
  let paths = [];
  let start = 0;
  let forward = true;
  let follow = 0;
  /**
   * @param {number} edge 0 for left, 1 for right.
   * @param {number} time
   */
  const edgeAt = (edge, time) => {
    const path = paths[edge];
    return path[Math.min(Math.floor((time - start) / 1000 / SPRING_STEP), path.length - 1)];
  };
  /** Keeps the leading edge in view, a margin from the end, until the highlight settles. */
  const keepInView = () => {
    const now = performance.now();
    const margin = Math.min(FOLLOW_MARGIN, nav.clientWidth / 4);
    const left = edgeAt(0, now).x;
    const right = edgeAt(1, now).x;
    const view = nav.scrollLeft;
    if (forward && right > view + nav.clientWidth - margin) {
      nav.scrollLeft = right - nav.clientWidth + margin;
    } else if (!forward && left < view + margin) nav.scrollLeft = left - margin;
    const moving = (now - start) / 1000 < Math.max(...paths.map(path => path.length)) * SPRING_STEP;
    follow = moving ? requestAnimationFrame(keepInView) : 0;
  };
  return link => {
    // The links can be rebuilt, taking the marker with them. It goes over them, turning
    // what it covers light.
    if (!marker.isConnected) nav.append(marker);
    marker.hidden = !link;
    if (!link) {
      to = null;
      return;
    }
    const target = {
      left: link.offsetLeft,
      right: link.offsetLeft + link.offsetWidth,
      top: link.offsetTop,
      width: link.offsetWidth
    };
    if (to && ['left', 'right', 'top'].every(key => to?.[key] === target[key])) return;
    const now = performance.now();
    const moving = to !== null;
    const [left, right] = moving
      ? [edgeAt(0, now), edgeAt(1, now)]
      : [
          { x: target.left, v: 0 },
          { x: target.right, v: 0 }
        ];
    forward = target.left >= left.x;
    paths = [
      springPath(left, target.left, forward ? TRAIL_STIFFNESS : LEAD_STIFFNESS),
      springPath(right, target.right, forward ? LEAD_STIFFNESS : TRAIL_STIFFNESS)
    ];
    to = target;
    start = now;
    marker.getAnimations().forEach(animation => animation.cancel());
    marker.style.width = `${target.width}px`;
    marker.style.height = `${link.offsetHeight}px`;
    /**
     * @param {number} x
     * @param {number} end
     */
    const pose = (x, end) =>
      `translate(${x}px, ${target.top}px) scaleX(${(end - x) / target.width})`;
    const steps = Math.max(paths[0].length, paths[1].length);
    if (!moving || steps < 3) {
      marker.style.transform = pose(target.left, target.right);
      if (target.left < nav.scrollLeft || target.right > nav.scrollLeft + nav.clientWidth) {
        nav.scrollLeft = target.left - (nav.clientWidth - target.width) / 2;
      }
      return;
    }
    const frames = Array.from({ length: steps }, (_, step) => {
      const time = now + step * SPRING_STEP * 1000;
      return { transform: pose(edgeAt(0, time).x, edgeAt(1, time).x) };
    });
    // Resting where it set off until the browser starts the move, and where it ends after.
    marker.style.transform = frames[0].transform;
    marker.animate(frames, { duration: (steps - 1) * SPRING_STEP * 1000, fill: 'forwards' });
    follow ||= requestAnimationFrame(keepInView);
  };
}

/**
 * Marks the link in `nav` to the section at the top of the window with `aria-current`, and
 * slides a highlight under it.
 * @param {HTMLElement} nav Links to sections on the page by `#id`.
 * @param {() => number} offset How much of the window the pinned bar covers.
 * @returns {() => void} Re-marks the links, for after they or the sections change.
 */
export function installScrollSpy(nav, offset) {
  let frame = 0;
  /** @type {HTMLAnchorElement | undefined} */
  let current;
  const place = createMarker(nav);
  const mark = () => {
    frame = 0;
    /** @type {HTMLAnchorElement[]} */
    const links = $$('a[href^="#"]', nav);
    const tops = links.map(
      link => document.getElementById(link.hash.slice(1))?.getBoundingClientRect().top ?? Infinity
    );
    const active = activeIndex(tops, offset() + SPY_SLACK);
    const link = links[active];
    place(link);
    // Left alone while it stays put, so a scroll within a year touches nothing.
    if (link === current) return;
    current?.removeAttribute('aria-current');
    link?.setAttribute('aria-current', 'location');
    current = link;
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
