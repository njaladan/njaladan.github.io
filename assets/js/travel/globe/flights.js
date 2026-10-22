// Elevated great-circle ribbons use MapLibre's globe projection and depth buffer.
// Heights are illustrative, not recorded aircraft altitudes.
import { drawFlights } from './flight-draw.js';
import {
  FLIGHT_MAX_ZOOM,
  VERTEX_FLOATS,
  nearestArc,
  projectArcPoint,
  ribbonVertices,
  routeArcs,
  sphereVertices,
  styleBatches
} from './flight-geometry.js';
import { flightProgram } from './flight-shader.js';

// Animated dashes redraw at about 30 frames per second.
const REPAINT_MS = 33;

/**
 * @typedef {import('./flight-geometry.js').RouteArc} RouteArc
 * @typedef {{ onSelect: (route: any, lngLat: any) => void,
 *   onHover?: (route: any, lngLat?: any) => void }} FlightCallbacks
 */

/**
 * Static geometry and mutable per-map state for one flight layer.
 * @param {any} log
 */
function createState(log) {
  const toMercator = lngLat => maplibregl.MercatorCoordinate.fromLngLat(lngLat);
  const routes = routeArcs(log, toMercator);
  return {
    routes,
    ...ribbonVertices(routes),
    sphere: sphereVertices(toMercator),
    programs: new Map(),
    styles: new Map(),
    motion: matchMedia('(prefers-reduced-motion: reduce)'),
    map: null,
    gl: { vao: null, flightBuffer: null, sphereBuffer: null },
    latest: null,
    repaintTimer: null,
    hovered: null,
    abort: null,
    modalObserver: null,
    batches: null,
    projectedRoutes: null,
    flowTime: 0,
    lastTime: null,
    projectionDirty: true
  };
}

/**
 * The dash flow holds still for reduced motion, hidden tabs, the photo
 * viewer and camera moves.
 * @param {ReturnType<typeof createState>} state
 * @returns {boolean}
 */
const paused = state =>
  state.motion.matches ||
  document.hidden ||
  document.body.classList.contains('photo-fullscreen') ||
  state.map?.isMoving();

/**
 * Map and document handlers for picking, hovering and resuming the flow.
 * @param {ReturnType<typeof createState>} state
 * @param {FlightCallbacks} callbacks
 */
function createHandlers(state, { onSelect, onHover }) {
  const nearestRoute = event => {
    if (!state.latest || state.map.getZoom() >= FLIGHT_MAX_ZOOM) return null;
    // Dash animation does not move the ribbons. Project each point once per
    // camera view, rather than both ends of every segment on every mousemove.
    const container = state.map.getContainer(),
      size = { width: container.clientWidth, height: container.clientHeight };
    state.projectedRoutes ||= state.routes.map(route => ({
      route,
      points: route.points.map(point => projectArcPoint(point, state.latest, size))
    }));
    return nearestArc(state.projectedRoutes, event.point);
  };
  const leave = () => {
    state.hovered = null;
    state.map.getCanvas().style.cursor = '';
    onHover?.(null);
  };
  return {
    pick(event) {
      const nearest = nearestRoute(event);
      if (nearest) {
        event.flightPicked = true;
        onSelect(nearest.route, event.lngLat);
      }
    },
    hover(event) {
      const nearest = nearestRoute(event);
      if (nearest === state.hovered) return;
      state.hovered = nearest;
      state.map.getCanvas().style.cursor = nearest ? 'pointer' : '';
      onHover?.(nearest?.route || null, event.lngLat);
    },
    leave,
    invalidateProjection() {
      state.projectedRoutes = null;
      state.projectionDirty = true;
    },
    resume() {
      state.lastTime = performance.now();
      if (!document.hidden) state.map?.triggerRepaint();
    }
  };
}

/**
 * @param {ReturnType<typeof createHandlers>} handlers
 * @returns {Array<[string, (event?: any) => void]>}
 */
const mapEvents = handlers => [
  ['click', handlers.pick],
  ['mousemove', handlers.hover],
  ['mouseout', handlers.leave],
  ['movestart', handlers.leave],
  ['move', handlers.invalidateProjection],
  ['resize', handlers.invalidateProjection]
];

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number[]} floats
 * @returns {WebGLBuffer}
 */
function staticBuffer(gl, floats) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floats), gl.STATIC_DRAW);
  return buffer;
}

/**
 * Uploads geometry and starts listening once MapLibre adds the layer.
 * @param {ReturnType<typeof createState>} state
 * @param {ReturnType<typeof createHandlers>} handlers
 * @param {any} owner the MapLibre map
 * @param {WebGL2RenderingContext} gl
 */
function attach(state, handlers, owner, gl) {
  state.map = owner;
  state.gl.vao = gl.createVertexArray();
  state.gl.flightBuffer = staticBuffer(gl, state.floats);
  state.gl.sphereBuffer = staticBuffer(gl, state.sphere);
  mapEvents(handlers).forEach(([type, handler]) => owner.on(type, handler));
  state.abort = new AbortController();
  const { signal } = state.abort;
  document.addEventListener('visibilitychange', handlers.resume, { signal });
  state.motion.addEventListener('change', handlers.resume, { signal });
  state.modalObserver = new MutationObserver(handlers.resume);
  state.modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

/**
 * Releases GL resources and listeners when MapLibre removes the layer.
 * @param {ReturnType<typeof createState>} state
 * @param {ReturnType<typeof createHandlers>} handlers
 * @param {any} owner the MapLibre map
 * @param {WebGL2RenderingContext} gl
 */
function detach(state, handlers, owner, gl) {
  mapEvents(handlers).forEach(([type, handler]) => owner.off(type, handler));
  gl.deleteBuffer(state.gl.flightBuffer);
  gl.deleteBuffer(state.gl.sphereBuffer);
  gl.deleteVertexArray(state.gl.vao);
  clearTimeout(state.repaintTimer);
  state.abort.abort();
  state.modalObserver.disconnect();
  state.programs.forEach(entry => gl.deleteProgram(entry.program));
  state.programs.clear();
}

/**
 * Draws a frame, advancing the dash flow unless paused, and keeps the
 * animation going with a throttled repaint.
 * @param {ReturnType<typeof createState>} state
 * @param {WebGL2RenderingContext} gl
 * @param {any} args MapLibre's custom layer render arguments
 */
function render(state, gl, args) {
  const zoom = state.map.getZoom();
  if (zoom >= FLIGHT_MAX_ZOOM) return;
  state.latest = args.defaultProjectionData;
  if (state.projectionDirty) {
    state.projectedRoutes = null;
    state.projectionDirty = false;
  }
  const entry = flightProgram(gl, args.shaderData, state.programs);
  const now = performance.now();
  if (state.lastTime !== null && !paused(state)) state.flowTime += now - state.lastTime;
  state.lastTime = now;
  state.batches ||= styleBatches(state.ranges, state.styles);
  drawFlights(gl, state.latest, {
    entry,
    ...state.gl,
    sphereCount: state.sphere.length / VERTEX_FLOATS,
    batches: state.batches,
    seconds: state.flowTime / 1000,
    zoom,
    pixelRatio: state.map.getPixelRatio()
  });
  if (!paused(state) && state.repaintTimer === null) {
    state.repaintTimer = setTimeout(() => {
      state.repaintTimer = null;
      state.map.triggerRepaint();
    }, REPAINT_MS);
  }
}

/**
 * A MapLibre custom layer drawing the log's flights as raised arcs. Styles
 * mirror the shared application's flat flight lines by route index.
 * @param {any} log
 * @param {FlightCallbacks} callbacks
 */
export function createGlobeFlights(log, { onSelect, onHover }) {
  const state = createState(log),
    handlers = createHandlers(state, { onSelect, onHover });
  return {
    id: 'elevated-flights',
    type: 'custom',
    renderingMode: '3d',
    routes: state.routes,
    setStyle(index, style) {
      state.styles.set(index, { ...style });
      state.batches = null;
      state.map?.triggerRepaint();
    },
    onAdd(owner, gl) {
      attach(state, handlers, owner, gl);
    },
    render(gl, args) {
      render(state, gl, args);
    },
    onRemove(owner, gl) {
      detach(state, handlers, owner, gl);
    }
  };
}
