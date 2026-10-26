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
const MAX_ZOOM = 16;
const ZOOM_MS = 260;
// How long the view must sit still before the map is redrawn sharp at the new zoom.
const SHARPEN_MS = 120;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = id => document.getElementById(id);
const stage = byId('cov-stage');
const canvas = /** @type {HTMLCanvasElement | null} */ (byId('cov-canvas'));
const summary = JSON.parse(byId('cov-summary')?.textContent || '{}');
const pctEl = byId('cov-pct');
const zoomBar = byId('cov-zoom');

/**
 * The zoom and pan, in CSS pixels of the stage: a point `p` on the unzoomed map shows at
 * `p * k + (x, y)`.
 */
const view = { k: 1, x: 0, y: 0 };
/** Called after every change to the view. */
let onZoom = () => {};
/** The running zoom animation's frame. */
let anim = 0;

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
 * @typedef {object} Lines The map's static lines, decoded once.
 * @property {number[][]} land
 * @property {number[][]} net
 * @property {number[][]} covered
 */

/**
 * @typedef {object} Pen How to paint the static layers.
 * @property {Lines} lines
 * @property {(x: number, y: number) => Point} toPx
 * @property {ReturnType<typeof palette>} colors
 * @property {number} ratio
 * @property {number} zoom Lines thicken with its square root, so streets stay apart.
 */

/**
 * The shoreline and street network on solid ground.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Pen} pen
 */
function paintNet(ctx, { lines, toPx, colors, ratio, zoom }) {
  const z = Math.sqrt(zoom);
  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.beginPath();
  for (const ring of pixelLines(lines.land, toPx)) {
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
  ctx.fillStyle = colors.land;
  ctx.fill();
  ctx.strokeStyle = colors.shore;
  ctx.lineWidth = Math.max(1, 1.2 * ratio) * z;
  ctx.stroke();
  ctx.strokeStyle = colors.street;
  ctx.lineWidth = Math.max(0.6, 0.6 * ratio) * z;
  strokeLines(ctx, pixelLines(lines.net, toPx));
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Pen} pen
 */
function paintCovered(ctx, { lines, toPx, colors, ratio, zoom }) {
  ctx.strokeStyle = colors.trail;
  ctx.lineWidth = Math.max(1, 1.3 * ratio) * Math.sqrt(zoom);
  strokeLines(ctx, pixelLines(lines.covered, toPx));
}

/**
 * Everything that depends on the canvas size: the projection, the static layers and the
 * tracks measured in pixels.
 * @param {MapData} data
 * @param {Lines} lines
 */
function layout(data, lines) {
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
  /** @type {Pen} */
  const pen = { lines, toPx, colors, ratio, zoom: 1 };
  paintNet(net.ctx, pen);
  const covered = offscreen(W, H);
  paintCovered(covered.ctx, pen);

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
  return {
    lines,
    toPx,
    ratio,
    colors,
    net: net.c,
    covered: covered.c,
    trail,
    tracks,
    headPx,
    /** Progress through the playback, 0–1. */
    u: 0,
    /** The cross-fade from the trails to the covered streets, 0–1. */
    a: 0,
    /**
     * The layers redrawn sharp at some zoom, and the view they were drawn for. The trails
     * are left out once the playback has faded to the covered streets.
     * @type {{ net: HTMLCanvasElement, covered: HTMLCanvasElement, trail: ReturnType<typeof offscreen> | null, k: number, x: number, y: number } | null}
     */
    sharp: null
  };
}

/** @typedef {ReturnType<typeof layout>} Scene */

/**
 * Draws the scene through the current view. While the view moves, the layers are scaled
 * up from their unzoomed size and the last sharp redraw is laid over them.
 * @param {Scene} scene
 */
function draw(scene) {
  const ctx = canvas.getContext('2d');
  const r = scene.ratio;
  ctx.setTransform(view.k, 0, 0, view.k, view.x * r, view.y * r);
  ctx.drawImage(scene.net, 0, 0);
  ctx.globalAlpha = 1 - scene.a;
  ctx.drawImage(scene.trail.c, 0, 0);
  ctx.globalAlpha = scene.a;
  ctx.drawImage(scene.covered, 0, 0);
  ctx.globalAlpha = 1;
  const sharp = scene.sharp;
  if (sharp) {
    const s = view.k / sharp.k;
    ctx.setTransform(s, 0, 0, s, (view.x - s * sharp.x) * r, (view.y - s * sharp.y) * r);
    ctx.drawImage(sharp.net, 0, 0);
    if (sharp.trail) {
      ctx.globalAlpha = 1 - scene.a;
      ctx.drawImage(sharp.trail.c, 0, 0);
    }
    ctx.globalAlpha = scene.a;
    ctx.drawImage(sharp.covered, 0, 0);
    ctx.globalAlpha = 1;
    // The heads are vectors, so they go on top already sharp.
    ctx.setTransform(view.k, 0, 0, view.k, view.x * r, view.y * r);
  }
  if (scene.u < 1) drawHeads(ctx, scene);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Redraws the layers' vectors at the current view, so zoomed streets and trails stay crisp.
 * The playback then extends the sharp trails alongside the unzoomed ones.
 * @param {Scene} scene
 */
function sharpen(scene) {
  if (view.k === 1) {
    scene.sharp = null;
    return;
  }
  const { k, x, y } = view;
  const r = scene.ratio;
  const net = offscreen(canvas.width, canvas.height);
  const covered = offscreen(canvas.width, canvas.height);
  /** @type {(x: number, y: number) => Point} */
  const toPx = (px, py) => {
    const [bx, by] = scene.toPx(px, py);
    return [bx * k + x * r, by * k + y * r];
  };
  /** @type {Pen} */
  const pen = { lines: scene.lines, toPx, colors: scene.colors, ratio: r, zoom: k };
  paintNet(net.ctx, pen);
  paintCovered(covered.ctx, pen);
  let trail = null;
  if (scene.a < 1) {
    // The tracks are measured in unzoomed pixels, so draw them through the view.
    trail = offscreen(canvas.width, canvas.height);
    trail.ctx.setTransform(k, 0, 0, k, x * r, y * r);
    trail.ctx.strokeStyle = scene.colors.trail;
    trail.ctx.lineWidth = (Math.max(1, 1.3 * r) * Math.sqrt(k)) / k;
    strokeLines(
      trail.ctx,
      scene.tracks.flatMap(t => (t.drawn > 0 ? sliceTrack(t.pieces, 0, t.drawn) : []))
    );
  }
  scene.sharp = { net: net.c, covered: covered.c, trail, k, x, y };
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
    const stretch = sliceTrack(track.pieces, Math.max(track.drawn - 1, 0), target);
    strokeLines(scene.trail.ctx, stretch);
    if (scene.sharp?.trail) strokeLines(scene.sharp.trail.ctx, stretch);
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
  ctx.lineWidth = (2 * scene.ratio) / Math.sqrt(view.k);
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
  let raf = 0;
  let t0 = 0;
  const fade = start => now => {
    const a = Math.min((now - start) / FADE_MS, 1);
    scene.a = ease(a);
    draw(scene);
    if (a < 1) raf = requestAnimationFrame(fade(start));
    else onDone();
  };
  const frame = now => {
    t0 ||= now;
    const u = reduce ? 1 : Math.min((now - t0) / PLAY_MS, 1);
    extendTrails(scene, u);
    scene.u = u;
    draw(scene);
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
  /** @type {Lines} */
  const lines = {
    land: data.land.map(decodeDeltas),
    net: data.net.map(decodeDeltas),
    covered: data.covered.map(decodeDeltas)
  };
  let stop = () => {};
  let finished = false;
  /** @type {Scene | null} */
  let scene = null;
  let cssWidth = 0;
  const redraw = () => {
    stop();
    const w = canvas.clientWidth;
    if (cssWidth) {
      // Keep the same part of the map in view at the new size.
      view.x *= w / cssWidth;
      view.y *= w / cssWidth;
    }
    cssWidth = w;
    const s = (scene = layout(data, lines));
    if (finished) {
      s.u = s.a = 1;
      sharpen(s);
      draw(s);
      return;
    }
    sharpen(s);
    stop = play(s, () => {
      finished = true;
      sharpen(s);
      draw(s);
    });
  };

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settle;
  let pending = 0;
  // Draws on the next frame unless the playback is already drawing every frame.
  const onViewChange = () => {
    stage.classList.toggle('is-zoomed', view.k > 1);
    if (!scene) return;
    if (finished && !pending) {
      pending = requestAnimationFrame(() => {
        pending = 0;
        draw(scene);
      });
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      sharpen(scene);
      if (finished) draw(scene);
    }, SHARPEN_MS);
  };
  onZoom = onViewChange;
  enableWheel();
  enablePointers();
  enableButtons();
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

/**
 * Keeps the view on the map: no zooming out past the whole island, no panning off it.
 * @param {number} k
 * @param {number} x
 * @param {number} y
 */
function setView(k, x, y) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  view.k = Math.min(Math.max(k, 1), MAX_ZOOM);
  view.x = Math.min(Math.max(x, w * (1 - view.k)), 0);
  view.y = Math.min(Math.max(y, h * (1 - view.k)), 0);
}

/**
 * Zooms to `k`, keeping the stage point (cx, cy) fixed.
 * @param {number} k
 * @param {number} cx
 * @param {number} cy
 */
function zoomAt(k, cx, cy) {
  const f = Math.min(Math.max(k, 1), MAX_ZOOM) / view.k;
  setView(view.k * f, cx - (cx - view.x) * f, cy - (cy - view.y) * f);
}

/** @param {{ clientX: number, clientY: number }} e */
function local(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/**
 * Eases the view to a zoom about a stage point.
 * @param {number} k
 * @param {number} cx
 * @param {number} cy
 */
function animateTo(k, cx, cy) {
  cancelAnimationFrame(anim);
  const from = { ...view };
  zoomAt(k, cx, cy);
  const to = { ...view };
  if (reduce) {
    onZoom();
    return;
  }
  Object.assign(view, from);
  let t0 = 0;
  const step = now => {
    t0 ||= now;
    const e = ease((now - t0) / ZOOM_MS);
    // Zoom geometrically, and pan in step with it, so the motion feels even.
    const kk = from.k * (to.k / from.k) ** e;
    const f = from.k === to.k ? e : (kk - from.k) / (to.k - from.k);
    Object.assign(view, {
      k: kk,
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f
    });
    onZoom();
    if (e < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

const WHEEL_UNITS = [1, 16, 400];

/** Ctrl/⌘-scroll and trackpad pinches zoom; scrolling pans once zoomed in. */
function enableWheel() {
  canvas.addEventListener(
    'wheel',
    e => {
      const unit = WHEEL_UNITS[e.deltaMode] ?? 1;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinches arrive as Ctrl-wheel events with small, frequent deltas.
        e.preventDefault();
        cancelAnimationFrame(anim);
        const p = local(e);
        const dy = Math.min(Math.max(e.deltaY * unit, -60), 60);
        zoomAt(view.k * Math.exp(-dy * 0.01), p.x, p.y);
        onZoom();
        return;
      }
      if (view.k === 1) return;
      const { x, y } = view;
      setView(view.k, x - e.deltaX * unit, y - e.deltaY * unit);
      // At an edge, let the page scroll on.
      if (view.x === x && view.y === y) return;
      e.preventDefault();
      cancelAnimationFrame(anim);
      onZoom();
    },
    { passive: false }
  );
}

/** Drag to pan, pinch to zoom, double-click or double-tap to zoom in. */
function enablePointers() {
  /** @type {Map<number, { x: number, y: number }>} */
  const pointers = new Map();
  /** @type {{ k: number, x: number, y: number, cx: number, cy: number, d: number } | null} */
  let start = null;
  const centre = () => {
    const ps = [...pointers.values()];
    const cx = ps.reduce((sum, p) => sum + p.x, 0) / ps.length;
    const cy = ps.reduce((sum, p) => sum + p.y, 0) / ps.length;
    const d = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { cx, cy, d };
  };
  const begin = () => {
    start = pointers.size ? { ...view, ...centre() } : null;
    stage.classList.toggle('is-dragging', pointers.size > 0 && view.k > 1);
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && (e.button !== 0 || view.k === 1)) return;
    cancelAnimationFrame(anim);
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    begin();
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !start) return;
    pointers.set(e.pointerId, local(e));
    const { cx, cy, d } = centre();
    const k = Math.min(Math.max(start.d && d ? (start.k * d) / start.d : start.k, 1), MAX_ZOOM);
    // The map point that was under the fingers stays under them.
    const bx = (start.cx - start.x) / start.k;
    const by = (start.cy - start.y) / start.k;
    setView(k, cx - bx * k, cy - by * k);
    onZoom();
  });
  const end = e => {
    if (pointers.delete(e.pointerId)) begin();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Two fingers always pinch the map; one finger only pans it once zoomed in.
  canvas.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length > 1 || view.k > 1) e.preventDefault();
    },
    { passive: false }
  );

  // Safari reports trackpad pinches as gesture events; on touch screens the pointers do.
  let gestureK = 1;
  canvas.addEventListener('gesturestart', e => {
    e.preventDefault();
    gestureK = view.k;
  });
  canvas.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (pointers.size) return;
    const g = /** @type {any} */ (e);
    const p = local(g);
    zoomAt(gestureK * g.scale, p.x, p.y);
    onZoom();
  });

  canvas.addEventListener('dblclick', e => {
    const p = local(e);
    animateTo(e.shiftKey ? view.k / 2 : view.k * 2, p.x, p.y);
  });
}

/** The zoom in, zoom out and reset buttons. */
function enableButtons() {
  if (!zoomBar) return;
  zoomBar.hidden = false;
  zoomBar.addEventListener('click', e => {
    const button = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!button) return;
    const step = { in: 2, out: 0.5 }[button.dataset.zoom];
    animateTo(step ? view.k * step : 1, canvas.clientWidth / 2, canvas.clientHeight / 2);
  });
}

init();
