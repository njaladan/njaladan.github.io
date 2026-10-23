import { ROUTE_MODES } from '../shared/data.js';
import { escapeHtml } from '../../lib/html.js';
import { readSetting } from '../../lib/storage.js';
import { REGIONAL_ZOOM, ROUTE_COLORS, TRANSPORT_COLOR, VISIT_COLORS } from './constants.js';
import { daySegments, dayBounds, longestSegment } from './activities.js';
import { popupOpen } from './camera.js';
import { activityLabel } from './card-content.js';
import { gondolaRide } from './gondola.js';
import { middlePoint } from './geometry.js';
import { asButton } from './keyboard.js';
import { HINT_SEEN_KEY, openActivity, openTransport } from './popups.js';
import { hitWeight, hoverRoute } from './route-style.js';

// Activity and transport routes: lines, hit targets, badges, legend and the
// flowing-dash animation of routes in view.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */
/** @typedef {import('./context.js').RouteEntry} RouteEntry */

const OUTLINE = { pane: 'routes', color: 'white', weight: 6, interactive: false };
const LINE = { pane: 'routes', weight: 3.5, opacity: 1, interactive: false };
// Below this zoom the legend lists flights only; other routes are too small to tell apart.
const LEGEND_ROUTE_ZOOM = 3.5;
// Below this zoom the legend explains the visited-country shading.
const LEGEND_VISIT_ZOOM = 5;
// Routes other than flights animate only above this zoom.
const ANIMATION_ZOOM = 3;
// The hint sits this far above the legend (px).
const HINT_GAP = 34;

/**
 * The "Tap any route" hint, shown once routes are legible until a card is opened.
 * @param {HTMLElement} main
 */
export function createRouteHint(main) {
  const hint = document.createElement('p');
  hint.id = 'route-hint';
  hint.hidden = true;
  const dot = document.createElement('span');
  dot.className = 'hint-dot';
  hint.append(dot, 'Tap any route for details');
  main.append(hint);
  return hint;
}

/**
 * @typedef {object} RouteTarget
 * @property {number[][]} coords
 * @property {string} label
 * @property {(latlng?: any) => void} open
 * @property {() => Element[]} hover
 */

/**
 * An invisible line makes thin routes easy to click.
 * @param {AtlasContext} ctx
 * @param {RouteTarget} target
 * @param {any} group
 */
function routeTarget(ctx, { coords, label, open, hover }, group) {
  const line = ctx.L.polyline(coords, {
    pane: 'routes',
    color: '#000',
    opacity: 0,
    weight: hitWeight(ctx),
    className: 'route-hit'
  })
    .bindTooltip(escapeHtml(label), { sticky: true })
    .on('click', event => open(event.latlng))
    .on('mouseover', () => hoverRoute(ctx, hover, true))
    .on('mouseout', () => hoverRoute(ctx, hover, false))
    .addTo(group);
  ctx.layers.hitLines.push(line);
  return line;
}

/**
 * The badge marks each route once, at its midpoint.
 * @param {AtlasContext} ctx
 * @param {RouteTarget & { modeKey: string, color: string }} target
 * @param {RouteEntry} entry
 */
function routeBadge(ctx, { coords, modeKey, color, label, open, hover }, entry) {
  const { L, cards } = ctx;
  const mid = cards.midpoint(coords);
  entry.badge = L.marker(mid, {
    icon: cards.badge(modeKey, color),
    keyboard: false,
    riseOnHover: true
  })
    .bindTooltip(escapeHtml(label), { direction: 'top', offset: [0, -12] })
    .on('click', () => open(L.latLng(mid)))
    .on('mouseover', () => hoverRoute(ctx, hover, true))
    .on('mouseout', () => hoverRoute(ctx, hover, false))
    .addTo(ctx.layers.badges);
}

/**
 * Draws one recorded activity: a white outline and colored line per segment.
 * @param {AtlasContext} ctx
 * @param {any} journey
 * @param {any} day
 * @param {number} index The day's index, which picks a fallback color.
 */
function renderActivity(ctx, journey, day, index) {
  const { L, layers } = ctx;
  const color = ROUTE_MODES[day.type]?.color || ROUTE_COLORS[index % ROUTE_COLORS.length];
  /** @type {RouteEntry} */
  const entry = { mode: day.type, bounds: [dayBounds(ctx, day)], layers: [] };
  if (entry.bounds[0].isValid()) layers.routeEntries.activities.push(entry);
  const label = activityLabel(ctx, day, journey),
    open = latlng => openActivity(ctx, day, journey, latlng);
  const hover = () => [...entry.layers.map(layer => layer.getElement()), entry.badge?.getElement()];
  layers.routeHover.set(`activity:${day.id}`, hover);
  daySegments(ctx, day).forEach(segment => {
    if (segment.length < 2) return;
    const outline = L.polyline(segment, {
      ...OUTLINE,
      opacity: 0.9,
      className: 'route-flow'
    }).addTo(layers.routes);
    const line = L.polyline(segment, {
      ...LINE,
      color,
      className: 'activity-route route-flow'
    }).addTo(layers.routes);
    routeTarget(ctx, { coords: segment, label, open, hover }, layers.routes);
    const node = line.getElement();
    if (node) asButton(node, label, () => open(middlePoint(segment)));
    layers.tracks.push({ id: day.id, color, outline, line });
    entry.layers.push(outline, line);
  });
  if (entry.layers.length) {
    const target = {
      coords: longestSegment(ctx, day),
      modeKey: day.type,
      color,
      label,
      open,
      hover
    };
    routeBadge(ctx, target, entry);
  }
}

/** @param {AtlasContext} ctx */
export function renderRoutes(ctx) {
  const { layers } = ctx;
  layers.routes.clearLayers();
  layers.tracks.length = 0;
  layers.routeEntries.activities.length = 0;
  ctx.state.journeys.forEach(journey =>
    (journey.days || []).forEach((day, index) => renderActivity(ctx, journey, day, index))
  );
}

/**
 * Draws one transport leg with its hit line and badge.
 * @param {AtlasContext} ctx
 * @param {any} trip
 */
function renderLeg(ctx, trip) {
  const { L, layers } = ctx;
  const color = ROUTE_MODES[trip.mode]?.color || TRANSPORT_COLOR;
  const outline = L.polyline(trip.coords, {
    ...OUTLINE,
    opacity: 0.85,
    className: 'route-flow'
  }).addTo(layers.transport);
  const line = L.polyline(trip.coords, {
    ...LINE,
    color,
    className: 'transport-route route-flow'
  }).addTo(layers.transport);
  /** @type {RouteEntry} */
  const entry = { mode: trip.mode, bounds: [line.getBounds()], layers: [outline, line] };
  layers.routeEntries.transport.push(entry);
  const open = latlng => openTransport(ctx, trip, latlng);
  const hover = () => [outline.getElement(), line.getElement(), entry.badge?.getElement()];
  layers.routeHover.set(`transport:${trip.id}`, hover);
  const target = { coords: trip.coords, label: trip.name, open, hover };
  const hit = routeTarget(ctx, target, layers.transport);
  routeBadge(ctx, { ...target, modeKey: trip.mode, color }, entry);
  if (trip.mode === 'Gondola') {
    const ride = gondolaRide(ctx, trip.coords, color);
    [hit, entry.badge].forEach(layer =>
      layer.on('mouseover', ride.start).on('mouseout', ride.stop)
    );
  }
  asButton(line.getElement(), `${trip.mode}: ${trip.name}`, () => open());
}

/** @param {AtlasContext} ctx */
export function renderTransport(ctx) {
  const { layers } = ctx;
  layers.transport.clearLayers();
  layers.routeEntries.transport.length = 0;
  ctx.state.transport.forEach(trip => renderLeg(ctx, trip));
  updateRouteLegend(ctx);
}

/** @param {AtlasContext} ctx */
const allEntries = ctx => Object.values(ctx.layers.routeEntries).flat();

/**
 * @param {string} color
 * @param {string} name
 */
const legendItem = (color, name) =>
  `<span><i style="background:${escapeHtml(color)}"></i>${escapeHtml(name)}</span>`;

/**
 * Lists the route types in view, plus the visit shading in wide views.
 * @param {AtlasContext} ctx
 */
export function updateRouteLegend(ctx) {
  const { map, legend } = ctx,
    bounds = map.getBounds(),
    zoom = map.getZoom();
  const types = new Set(
    allEntries(ctx)
      .filter(entry => entry.bounds.some(routeBounds => routeBounds.intersects(bounds)))
      .map(entry => entry.mode)
  );
  const modes = [...types].filter(
    type => ROUTE_MODES[type] && (zoom >= LEGEND_ROUTE_ZOOM || type === 'Flight')
  );
  const visits =
    zoom < LEGEND_VISIT_ZOOM
      ? legendItem(VISIT_COLORS.visited, 'Visited') + legendItem(VISIT_COLORS.home, 'Home')
      : '';
  const content =
    visits +
    modes.map(type => legendItem(ROUTE_MODES[type].color, ROUTE_MODES[type].name)).join('');
  if (legend.innerHTML !== content) legend.innerHTML = content;
  legend.hidden = !visits && !modes.length;
  ctx.hint.style.bottom = `${legend.offsetHeight + HINT_GAP}px`;
}

/**
 * Animates the dashes of routes in view; the rest stay still.
 * @param {AtlasContext} ctx
 */
export function updateRouteAnimations(ctx) {
  const { map } = ctx;
  ctx.state.routeFrame = null;
  const bounds = map.getBounds(),
    zoom = map.getZoom();
  allEntries(ctx).forEach(entry => {
    const visible =
      !document.hidden &&
      (entry.mode === 'Flight' || zoom > ANIMATION_ZOOM) &&
      entry.bounds.some(routeBounds => routeBounds.intersects(bounds));
    entry.layers.forEach(layer => {
      // Leaflet clips paths to its renderer bounds at moveend. An empty
      // clipped path needs no animation even when its broad bounds overlap.
      const active = visible && layer._parts?.some(part => part.length > 1);
      layer.getElement()?.classList.toggle('route-flow-active', Boolean(active));
    });
  });
  map.getContainer().classList.toggle('map-moving', ctx.state.cameraMoving);
}

/** @param {AtlasContext} ctx */
export function queueRouteAnimations(ctx) {
  if (ctx.state.routeFrame === null) {
    ctx.state.routeFrame = requestAnimationFrame(() => updateRouteAnimations(ctx));
  }
}

/** @param {AtlasContext} ctx */
export function cancelRouteAnimations(ctx) {
  if (ctx.state.routeFrame !== null) cancelAnimationFrame(ctx.state.routeFrame);
  ctx.state.routeFrame = null;
}

/**
 * Badges, wide hit lines and the hint appear once routes are legible.
 * @param {AtlasContext} ctx
 */
export function updateBadges(ctx) {
  const { map, layers } = ctx;
  const show = map.getZoom() >= REGIONAL_ZOOM,
    weight = hitWeight(ctx);
  if (show !== map.hasLayer(layers.badges)) {
    if (show) layers.badges.addTo(map);
    else map.removeLayer(layers.badges);
  }
  if (layers.hitLines[0] && layers.hitLines[0].options.weight !== weight) {
    layers.hitLines.forEach(line => line.setStyle({ weight }));
  }
  ctx.hint.hidden = readSetting(HINT_SEEN_KEY) === '1' || !show || popupOpen(ctx);
}
