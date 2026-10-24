// Every street in Manhattan: replays every activity in date order on a map of the
// street network, then settles on the streets that count as covered.
import { stampedUrl } from './lib/assets.js';
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
 * @property {number[][]} land Manhattan's shoreline, one ring per island.
 */

/**
 * @typedef {object} Track
 * @property {string} date
 * @property {Piece[]} pieces
 * @property {number} length In canvas pixels.
 * @property {number} drawn How much of it is on the trail canvas.
 * @property {number} start When it starts, as a share of the playback.
 */

const PLAY_MS = 16000;
// Each activity draws over this share of the playback.
const SPAN = 0.14;
const FADE_MS = 1200;
const PAD = 0.03;
const HEAD_METRES = 500;
const MAX_PIXEL_RATIO = 2;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = id => document.getElementById(id);
const stage = byId('cov-stage');
const canvas = /** @type {HTMLCanvasElement | null} */ (byId('cov-canvas'));
const summary = JSON.parse(byId('cov-summary')?.textContent || '{}');
const pctEl = byId('cov-pct');

/** The map's colours, from the stylesheet's custom properties. */
function palette() {
  const css = getComputedStyle(stage);
  const read = name => css.getPropertyValue(name).trim();
  return {
    ground: read('--map-ground'),
    land: read('--map-land'),
    shore: read('--map-shore'),
    street: read('--map-street'),
    trail: read('--map-trail'),
    head: read('--map-head')
  };
}

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
  const ctx = c.getContext('2d');
  ctx.lineCap = ctx.lineJoin = 'round';
  return { c, ctx };
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
  const colors = palette();
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
  const lineWidth = Math.max(1, 1.3 * ratio);

  const net = offscreen(W, H);
  net.ctx.fillStyle = colors.ground;
  net.ctx.fillRect(0, 0, W, H);
  net.ctx.beginPath();
  for (const ring of pixelLines(data.land.map(decodeDeltas), toPx)) {
    ring.forEach(([x, y], i) => (i ? net.ctx.lineTo(x, y) : net.ctx.moveTo(x, y)));
    net.ctx.closePath();
  }
  net.ctx.fillStyle = colors.land;
  net.ctx.fill();
  net.ctx.strokeStyle = colors.shore;
  net.ctx.lineWidth = Math.max(1, 1.2 * ratio);
  net.ctx.stroke();
  net.ctx.strokeStyle = colors.street;
  net.ctx.lineWidth = Math.max(0.6, 0.6 * ratio);
  strokeLines(net.ctx, pixelLines(data.net.map(decodeDeltas), toPx));

  const covered = offscreen(W, H);
  covered.ctx.strokeStyle = colors.trail;
  covered.ctx.lineWidth = lineWidth;
  strokeLines(covered.ctx, pixelLines(data.covered.map(decodeDeltas), toPx));

  const trail = offscreen(W, H);
  trail.ctx.strokeStyle = colors.trail;
  trail.ctx.lineWidth = lineWidth;

  /** @type {Track[]} */
  const tracks = data.tracks.map((t, i) => {
    const { pieces, length } = measurePieces(t.p.map(decodeDeltas), toPx);
    const start = (i / data.tracks.length) * (1 - SPAN);
    return { date: t.d, pieces, length, drawn: 0, start };
  });
  const headPx = (HEAD_METRES / data.q) * scale;
  return { ratio, colors, net: net.c, covered: covered.c, trail, tracks, headPx };
}

/** @typedef {ReturnType<typeof layout>} Scene */

/**
 * The finished map, cross-fading from the trails to the covered streets by `a`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Scene} scene
 * @param {number} a
 */
function paintStill(ctx, scene, a) {
  ctx.drawImage(scene.net, 0, 0);
  ctx.globalAlpha = 1 - a;
  ctx.drawImage(scene.trail.c, 0, 0);
  ctx.globalAlpha = a;
  ctx.drawImage(scene.covered, 0, 0);
  ctx.globalAlpha = 1;
}

/**
 * Adds every track's newly travelled stretch to the trail canvas.
 * @param {Scene} scene
 * @param {number} u Progress through the playback, 0–1.
 */
function extendTrails(scene, u) {
  for (const track of scene.tracks) {
    const target = ease((u - track.start) / SPAN) * track.length;
    if (target <= track.drawn) continue;
    strokeLines(scene.trail.ctx, sliceTrack(track.pieces, Math.max(track.drawn - 1, 0), target));
    track.drawn = target;
  }
}

/**
 * Draws a bright head on every track still moving.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Scene} scene
 */
function drawHeads(ctx, scene) {
  ctx.lineCap = 'round';
  ctx.lineWidth = 2 * scene.ratio;
  ctx.strokeStyle = scene.colors.head;
  const heads = scene.tracks
    .filter(t => t.drawn > 0 && t.drawn < t.length)
    .flatMap(t => sliceTrack(t.pieces, Math.max(t.drawn - scene.headPx, 0), t.drawn));
  strokeLines(ctx, heads);
}

/**
 * Counts the big figure up with the playback: the coverage reached by the activity
 * being drawn, ending on today's figure.
 * @param {Scene} scene
 * @param {number} u
 */
function updateText(scene, u) {
  const dates = scene.tracks.map(t => t.date);
  const pct = u >= 1 ? summary.now : inOrderAt(dates, summary.years, u / (1 - SPAN)).pct;
  pctEl.textContent = pct.toFixed(1);
}

/**
 * Plays the scene from the start; returns a function that stops it.
 * @param {Scene} scene
 * @param {() => void} onDone
 */
function play(scene, onDone) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let t0 = 0;
  const fade = start => now => {
    const a = Math.min((now - start) / FADE_MS, 1);
    paintStill(ctx, scene, ease(a));
    if (a < 1) raf = requestAnimationFrame(fade(start));
    else onDone();
  };
  const frame = now => {
    t0 ||= now;
    const u = reduce ? 1 : Math.min((now - t0) / PLAY_MS, 1);
    extendTrails(scene, u);
    ctx.drawImage(scene.net, 0, 0);
    ctx.drawImage(scene.trail.c, 0, 0);
    if (u < 1) drawHeads(ctx, scene);
    updateText(scene, u);
    if (u < 1) raf = requestAnimationFrame(frame);
    else if (reduce) fade(now)(now + FADE_MS);
    else raf = requestAnimationFrame(fade(now));
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

async function init() {
  if (!stage || !canvas || !pctEl || !summary.years) return;
  const data = await loadMap();
  const loading = byId('cov-loading');
  if (!data) {
    loading.textContent = "The map couldn't be loaded.";
    return;
  }
  loading.remove();
  stage.style.setProperty('--ar', String(data.w / data.h));
  let stop = () => {};
  let finished = false;
  const redraw = () => {
    stop();
    const scene = layout(data);
    if (finished) {
      paintStill(canvas.getContext('2d'), scene, 1);
      return;
    }
    stop = play(scene, () => {
      finished = true;
    });
  };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resize;
  let width = 0;
  new ResizeObserver(([entry]) => {
    // Phones resize the stage as the address bar slides; only a new width needs a redraw.
    if (Math.round(entry.contentRect.width) === width) return;
    width = Math.round(entry.contentRect.width);
    clearTimeout(resize);
    resize = setTimeout(redraw, 150);
  }).observe(stage);
}

init();
