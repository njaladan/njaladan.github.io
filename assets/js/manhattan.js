// Every street in Manhattan: replays every activity on a night map of the street
// network, either all at once at one speed or in date order, then settles on the
// streets that count as covered.
import { stampedUrl } from './lib/assets.js';
import { $$ } from './lib/dom.js';
import { decodeDeltas, ease, inOrderAt, measurePieces, sliceTrack } from './athletics/coverage.js';

/** @typedef {import('./athletics/coverage.js').Point} Point */
/** @typedef {import('./athletics/coverage.js').Piece} Piece */

/**
 * @typedef {object} MapData Written by the street coverage pipeline.
 * @property {number} w Extent in data units.
 * @property {number} h
 * @property {number} q Metres per data unit.
 * @property {Array<{ d: string, b: 0 | 1, p: number[][] }>} tracks Sorted by date.
 * @property {number[][]} net The whole street network.
 * @property {number[][]} covered The street segments that count as covered.
 */

/**
 * @typedef {object} Track
 * @property {string} date
 * @property {boolean} bike
 * @property {Piece[]} pieces
 * @property {number} length In canvas pixels.
 * @property {number} drawn How much of it is on the trail canvas.
 * @property {number} start In-order schedule, as a share of the playback.
 */

// The longest activity finishes in this many seconds when everything moves at one speed.
const SPEED_SECONDS = 26;
const ORDER_MS = 16000;
// In order, each activity draws over this share of the playback.
const ORDER_SPAN = 0.14;
const FADE_MS = 1200;
const PAD = 0.03;
const HEAD_METRES = 500;
const MAX_PIXEL_RATIO = 2;
const GLOW_SCALE = 4;
const NIGHT = '#05070d';
const NET = '#1c2333';
const AMBER = '#ffc861';
const FOOT_PASS = 'rgba(255, 200, 97, 0.24)';
const BIKE_PASS = 'rgba(94, 242, 255, 0.24)';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = id => document.getElementById(id);
const stage = byId('cov-stage');
const canvas = /** @type {HTMLCanvasElement | null} */ (byId('cov-canvas'));
const summary = JSON.parse(byId('cov-summary')?.textContent || '{}');
const pctEl = byId('cov-pct');
const subEl = byId('cov-sub');
const liveEl = byId('cov-live');

/** @type {{ mode: 'all' | 'order', style: 'glow' | 'flat' }} */
const state = { mode: 'all', style: 'glow' };

/** @returns {Promise<MapData | null>} */
async function loadMap() {
  try {
    const response = await fetch(stampedUrl(stage.dataset.url, location.href));
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} w
 * @param {number} h
 */
function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Strokes every line in one path.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Iterable<Point[]>} lines
 */
function strokeLines(ctx, lines) {
  ctx.beginPath();
  for (const pts of lines) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
}

/**
 * Decoded lines in canvas pixels.
 * @param {number[][]} lines
 * @param {(x: number, y: number) => Point} toPx
 */
function* pixelLines(lines, toPx) {
  for (const flat of lines) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(toPx(flat[i], flat[i + 1]));
    yield pts;
  }
}

/**
 * Everything that depends on the canvas size: the projection, the static layers and the
 * tracks measured in pixels.
 * @param {MapData} data
 */
function layout(data) {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const rect = stage.getBoundingClientRect();
  const W = Math.round(rect.width * ratio);
  const H = Math.round(rect.height * ratio);
  canvas.width = W;
  canvas.height = H;
  const scale = Math.min(W / (data.w * (1 + 2 * PAD)), H / (data.h * (1 + 2 * PAD)));
  const ox = (W - data.w * scale) / 2;
  const oy = (H - data.h * scale) / 2;
  /** @type {(x: number, y: number) => Point} */
  const toPx = (x, y) => [ox + x * scale, H - (oy + y * scale)];

  const net = offscreen(W, H);
  const n = net.getContext('2d');
  n.fillStyle = NIGHT;
  n.fillRect(0, 0, W, H);
  n.strokeStyle = NET;
  n.lineWidth = Math.max(0.6, 0.55 * ratio);
  n.lineJoin = 'round';
  strokeLines(n, pixelLines(data.net.map(decodeDeltas), toPx));

  const covered = offscreen(W, H);
  const cc = covered.getContext('2d');
  Object.assign(cc, { strokeStyle: AMBER, lineCap: 'round', lineJoin: 'round' });
  cc.lineWidth = Math.max(1, 1.3 * ratio);
  strokeLines(cc, pixelLines(data.covered.map(decodeDeltas), toPx));

  /** @type {Track[]} */
  const tracks = data.tracks.map((t, i) => {
    const { pieces, length } = measurePieces(t.p.map(decodeDeltas), toPx);
    const start = (i / data.tracks.length) * (1 - ORDER_SPAN);
    return { date: t.d, bike: t.b === 1, pieces, length, drawn: 0, start };
  });
  const trail = offscreen(W, H);
  const glow = offscreen(Math.ceil(W / GLOW_SCALE), Math.ceil(H / GLOW_SCALE));
  const headPx = (HEAD_METRES / data.q) * scale;
  const metresPerPx = data.q / scale;
  return { W, H, ratio, net, covered, trail, glow, tracks, headPx, metresPerPx };
}

/** @typedef {ReturnType<typeof layout>} Scene */

/**
 * Draws `layer` onto the map with a cheap glow: the layer shrunk and stretched back up.
 * Avoids `ctx.filter`, which Safari lacks.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Scene} scene
 * @param {HTMLCanvasElement} layer
 * @param {number} alpha
 */
function drawLayer(ctx, scene, layer, alpha) {
  const flat = state.style === 'flat';
  const g = scene.glow.getContext('2d');
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = flat ? 'source-over' : 'lighter';
  ctx.drawImage(layer, 0, 0);
  g.clearRect(0, 0, scene.glow.width, scene.glow.height);
  g.drawImage(layer, 0, 0, scene.glow.width, scene.glow.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha * (flat ? 0.55 : 0.9);
  ctx.drawImage(scene.glow, 0, 0, scene.W, scene.H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * The finished map, cross-fading from the trails to the covered streets by `a`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Scene} scene
 * @param {number} a
 */
function paintStill(ctx, scene, a) {
  ctx.drawImage(scene.net, 0, 0);
  if (a < 1) drawLayer(ctx, scene, scene.trail, 1 - a);
  drawLayer(ctx, scene, scene.covered, a);
}

/**
 * Adds every track's newly travelled stretch to the trail canvas.
 * @param {Scene} scene
 * @param {(t: Track) => number} progress Share of each track drawn by now.
 */
function extendTrails(scene, progress) {
  const flat = state.style === 'flat';
  const t = scene.trail.getContext('2d');
  t.lineCap = t.lineJoin = 'round';
  t.globalCompositeOperation = flat ? 'source-over' : 'lighter';
  t.lineWidth = Math.max(1, (flat ? 1.3 : 1.1) * scene.ratio);
  for (const track of scene.tracks) {
    const target = progress(track) * track.length;
    if (target <= track.drawn) continue;
    if (flat) t.strokeStyle = AMBER;
    else t.strokeStyle = track.bike ? BIKE_PASS : FOOT_PASS;
    strokeLines(t, sliceTrack(track.pieces, Math.max(track.drawn - 1, 0), target));
    track.drawn = target;
  }
}

/**
 * Draws a bright head on every track still moving.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Scene} scene
 */
function drawHeads(ctx, scene) {
  const flat = state.style === 'flat';
  ctx.lineCap = 'round';
  ctx.lineWidth = (flat ? 1.3 : 2) * scene.ratio;
  ctx.strokeStyle = flat ? AMBER : 'rgba(255, 250, 235, 0.95)';
  ctx.shadowColor = 'rgba(255, 240, 210, 0.9)';
  ctx.shadowBlur = flat ? 0 : 8 * scene.ratio;
  const heads = scene.tracks
    .filter(t => t.drawn > 0 && t.drawn < t.length)
    .flatMap(t => sliceTrack(t.pieces, Math.max(t.drawn - scene.headPx, 0), t.drawn));
  strokeLines(ctx, heads);
  ctx.shadowBlur = 0;
}

/**
 * Updates the figures beside the map for progress `u`.
 * @param {Scene} scene
 * @param {number} u
 */
function updateText(scene, u) {
  if (state.mode === 'order' && u < 1) {
    const { year, pct } = inOrderAt(
      scene.tracks.map(t => t.date),
      summary.years,
      u / (1 - ORDER_SPAN)
    );
    pctEl.textContent = pct.toFixed(1);
    subEl.innerHTML = `of Manhattan's streets by <span class="cov-year-now">${year}</span>`;
    liveEl.textContent = '';
    return;
  }
  pctEl.textContent = summary.now.toFixed(1);
  subEl.textContent = "of Manhattan's streets covered";
  if (state.mode === 'order') {
    liveEl.textContent = '';
    return;
  }
  const km = Math.round((scene.tracks.reduce((a, t) => a + t.drawn, 0) * scene.metresPerPx) / 1000);
  const moving = scene.tracks.filter(t => t.drawn > 0 && t.drawn < t.length - 0.5).length;
  liveEl.textContent =
    u < 1
      ? `${km.toLocaleString()} km travelled, ${moving} still going`
      : `${km.toLocaleString()} km travelled across ${scene.tracks.length} activities`;
}

/**
 * Plays the scene from the start; returns a function that stops it.
 * @param {Scene} scene
 */
function play(scene) {
  const ctx = canvas.getContext('2d');
  const longest = Math.max(...scene.tracks.map(t => t.length));
  let raf = 0;
  let t0 = 0;
  /** @type {(u: number) => (t: Track) => number} */
  const progressAt = u => t =>
    state.mode === 'all' ? Math.min((u * longest) / t.length, 1) : ease((u - t.start) / ORDER_SPAN);

  const fade = start => now => {
    const a = Math.min((now - start) / FADE_MS, 1);
    paintStill(ctx, scene, ease(a));
    if (a < 1) raf = requestAnimationFrame(fade(start));
  };
  const frame = now => {
    t0 ||= now;
    const elapsed = now - t0;
    let u = state.mode === 'all' ? elapsed / 1000 / SPEED_SECONDS : elapsed / ORDER_MS;
    if (reduce) u = 1;
    u = Math.min(u, 1);
    extendTrails(scene, progressAt(u));
    ctx.drawImage(scene.net, 0, 0);
    drawLayer(ctx, scene, scene.trail, 1);
    if (u < 1) drawHeads(ctx, scene);
    updateText(scene, u);
    if (u < 1) raf = requestAnimationFrame(frame);
    else if (state.style === 'flat' && !reduce) raf = requestAnimationFrame(fade(now));
    else if (state.style === 'flat') paintStill(ctx, scene, 1);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/**
 * Wires a toggle group to `state[key]`.
 * @param {'mode' | 'style'} key
 * @param {() => void} restart
 */
function toggle(key, restart) {
  const buttons = $$(`[data-${key}]`);
  buttons.forEach(b =>
    b.addEventListener('click', () => {
      Object.assign(state, { [key]: b.dataset[key] });
      buttons.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      if (key === 'style') {
        byId('cov-legend').hidden = state.style === 'flat';
        byId('cov-legend-flat').hidden = state.style !== 'flat';
      }
      restart();
    })
  );
}

async function init() {
  if (!stage || !canvas || !pctEl || !subEl || !liveEl || !summary.years) return;
  const data = await loadMap();
  const loading = byId('cov-loading');
  if (!data) {
    loading.textContent = "The map couldn't be loaded.";
    return;
  }
  loading.remove();
  stage.style.setProperty('--ar', String(data.w / data.h));
  let stop = () => {};
  const restart = () => {
    stop();
    stop = play(layout(data));
  };
  toggle('mode', restart);
  toggle('style', restart);
  byId('cov-replay').addEventListener('click', restart);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resize;
  let width = 0;
  new ResizeObserver(([entry]) => {
    // Phones resize the stage as the address bar slides; only a new width needs a redraw.
    if (Math.round(entry.contentRect.width) === width) return;
    width = Math.round(entry.contentRect.width);
    clearTimeout(resize);
    resize = setTimeout(restart, 150);
  }).observe(stage);
}

init();
