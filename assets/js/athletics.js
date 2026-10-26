// Athletics: every GPS activity drawn as a shape, shuffled, with sport/year filters kept
// in the address, a viewer that draws one shape in, and a canvas "stack" of every
// selected shape.
import { stampedUrl } from './lib/assets.js';
import {
  installBackToTop,
  installIndexBar,
  installPills,
  readQuery,
  writeQuery
} from './lib/collection.js';
import {
  SPORTS,
  chipButton,
  drawSchedule,
  filterShapes,
  formatDate,
  prepareShapes,
  shapeCell,
  shapeEnds,
  shapeLines,
  shapeYears,
  sportColor,
  stackAlpha
} from './athletics/shapes.js';

/** @typedef {import('./athletics/shapes.js').Shape} Shape */

const DRAW_MS = 1600;
const RESIZE_DEBOUNCE_MS = 150;
// Shapes are drawn in a 0–1000 box; the stack zooms out with a margin on every side.
const STACK_MARGIN = 70;
const STACK_SIZE = 1000 + 2 * STACK_MARGIN;
const STACK_FALLBACK_WIDTH = 720;
// Match phone screens up to 3x; the stack canvas is small enough there to afford it.
const MAX_PIXEL_RATIO = 3;
// Keep the canvas backing store within ~16 MB however wide the screen and ratio.
const MAX_STACK_PX = 2048;

/**
 * Fetches the shapes written by scripts/athletics/build_athletics_shapes.py.
 * @returns {Promise<Array<{ date: string, sport: string, segs: number[][] }>>}
 */
async function loadShapes() {
  const url = document.getElementById('shape-grid')?.dataset.shapesUrl;
  if (!url) return [];
  try {
    const response = await fetch(stampedUrl(url, location.href));
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

/** @type {Shape[]} */
const all = prepareShapes(await loadShapes());
/** @type {{ sport: string, year: 'all' | number, view: string }} */
const state = { sport: 'all', year: 'all', view: 'grid' };
// The filters as the address shows them, and their values with nothing chosen.
const DEFAULTS = { sport: 'all', year: 'all', view: 'grid' };
/** Shapes currently shown, and the one open in the viewer. @type {Shape[]} */
let list = [];
let current = -1;

/**
 * @typedef {object} Elements
 * @property {HTMLElement} sports
 * @property {HTMLElement} years
 * @property {HTMLElement} views
 * @property {HTMLElement} bar
 * @property {HTMLElement} count
 * @property {HTMLElement} grid
 * @property {HTMLElement} stack
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLDialogElement} viewer
 * @property {SVGSVGElement} big The viewer's drawing.
 * @property {HTMLElement} title
 * @property {HTMLElement} date
 * @property {HTMLElement} close
 */

/** @type {Elements} */
let ui;

/** @param {string} id */
const byId = id => document.getElementById(id);

/**
 * Fills `el` with one chip per key; picking a chip sets `state[key]` and re-renders.
 * @param {HTMLElement} el
 * @param {{ keys: Array<string | number>, label: (key: any) => string, swatch: boolean, key: 'sport' | 'year' }} options
 * @returns {import('./lib/collection.js').Pills}
 */
function chips(el, { keys, label, swatch, key }) {
  el.innerHTML = keys.map(k => chipButton({ key: k, text: String(label(k)), swatch })).join('');
  return installPills(el, value => {
    state[key] = /** @type {any} */ (keys.find(k => String(k) === value));
    render();
  });
}

function render() {
  writeQuery({ sport: state.sport, year: String(state.year), view: state.view }, DEFAULTS);
  list = filterShapes(all, state);
  ui.count.textContent = `${list.length.toLocaleString()} shapes`;
  ui.grid.hidden = state.view !== 'grid';
  ui.stack.hidden = state.view !== 'stack';
  if (state.view === 'grid') {
    ui.grid.innerHTML = list.map(shapeCell).join('');
  } else {
    drawStack();
  }
}

// A canvas keeps the stack light on phones; a thousand blended SVG paths can exhaust memory on iOS.
function drawStack() {
  const { canvas } = ui;
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  // The drawable width, without the border, so canvas pixels map 1:1 onto the screen.
  const css = canvas.clientWidth || STACK_FALLBACK_WIDTH;
  const px = Math.min(MAX_STACK_PX, Math.round(css * ratio));
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const scale = px / STACK_SIZE;
  ctx.setTransform(scale, 0, 0, scale, STACK_MARGIN * scale, STACK_MARGIN * scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-STACK_MARGIN, -STACK_MARGIN, STACK_SIZE, STACK_SIZE);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = stackAlpha(list.length);
  // Half a CSS pixel wide at any canvas size: hairlines keep a thousand routes legible.
  ctx.lineWidth = (0.5 * px) / css / scale;
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const s of list) {
    ctx.strokeStyle = sportColor(s.sport);
    ctx.beginPath();
    for (const seg of s.segs) {
      ctx.moveTo(seg[0], seg[1]);
      for (let i = 2; i < seg.length; i += 2) ctx.lineTo(seg[i], seg[i + 1]);
    }
    ctx.stroke();
  }
}

/**
 * Opens shape `n` of the list in the viewer, wrapping at either end.
 * @param {number} n
 */
function open(n) {
  current = (n + list.length) % list.length;
  const s = list[current];
  ui.title.textContent = SPORTS[s.sport].name;
  ui.date.textContent = formatDate(s.date);
  ui.big.innerHTML = shapeLines(s) + shapeEnds(s);
  if (!ui.viewer.open) ui.viewer.showModal();
  draw();
}

// Draws the route in at one speed across all its segments, then shows where it ended.
function draw() {
  const polys = [...ui.big.querySelectorAll('polyline')];
  const lengths = polys.map(p => p.getTotalLength());
  const schedule = drawSchedule(lengths, DRAW_MS);
  polys.forEach((p, i) => {
    p.style.transition = 'none';
    p.style.strokeDasharray = String(lengths[i]);
    p.style.strokeDashoffset = String(lengths[i]);
    // Commit the hidden state before transitioning out of it.
    p.getBoundingClientRect();
    p.style.transition = `stroke-dashoffset ${schedule[i].share}ms linear ${schedule[i].delay}ms`;
    p.style.strokeDashoffset = '0';
  });
  const end = ui.big.querySelector('.shape-end');
  if (!(end instanceof SVGElement)) return;
  end.style.transition = `opacity .3s ${DRAW_MS}ms`;
  requestAnimationFrame(() => end.setAttribute('opacity', '1'));
}

function installControls() {
  const keys = { sport: ['all', 'run', 'ride', 'foot', 'snow'], year: ['all', ...shapeYears(all)] };
  const sports = chips(ui.sports, {
    keys: keys.sport,
    label: k => (k === 'all' ? 'Everything' : SPORTS[k].label),
    swatch: true,
    key: 'sport'
  });
  const years = chips(ui.years, {
    keys: keys.year,
    label: k => (k === 'all' ? 'All years' : k),
    swatch: false,
    key: 'year'
  });
  const views = installPills(ui.views, value => {
    state.view = value;
    render();
  });
  // A link to a filtered view opens on it; values the page doesn't offer are ignored.
  const chosen = readQuery(location.search, DEFAULTS);
  if (sports.select(chosen.sport)) state.sport = chosen.sport;
  if (years.select(chosen.year)) {
    state.year = /** @type {any} */ (keys.year.find(k => String(k) === chosen.year));
  }
  if (views.select(chosen.view)) state.view = chosen.view;
  installIndexBar(ui.bar);
  installBackToTop();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resize;
  window.addEventListener('resize', () => {
    clearTimeout(resize);
    resize = setTimeout(() => {
      if (state.view === 'stack') drawStack();
    }, RESIZE_DEBOUNCE_MS);
  });
}

function installViewer() {
  const { grid, viewer } = ui;
  grid.addEventListener('click', e => {
    const b = /** @type {Element} */ (e.target).closest('.shape-cell');
    if (b instanceof HTMLElement) open(Number(b.dataset.n));
  });
  ui.close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', e => {
    if (e.target === viewer) viewer.close();
  });
  document.addEventListener('keydown', e => {
    if (!viewer.open) return;
    if (e.key === 'ArrowRight') open(current + 1);
    if (e.key === 'ArrowLeft') open(current - 1);
  });
}

function init() {
  const elements = {
    sports: byId('shape-sports'),
    years: byId('shape-years'),
    views: byId('shape-view'),
    bar: /** @type {HTMLElement | null} */ (document.querySelector('[data-index-bar]')),
    count: byId('shape-count'),
    grid: byId('shape-grid'),
    stack: byId('shape-stack'),
    canvas: byId('shape-canvas'),
    viewer: byId('shape-viewer'),
    big: byId('shape-svg'),
    title: byId('shape-title'),
    date: byId('shape-date'),
    close: byId('shape-close')
  };
  if (!Object.values(elements).every(Boolean)) return;
  ui = /** @type {Elements} */ (/** @type {unknown} */ (elements));
  installControls();
  installViewer();
  render();
}

init();
