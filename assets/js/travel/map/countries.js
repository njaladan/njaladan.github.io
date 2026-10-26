import { COUNTRY_PLACES, HOME_COUNTRY, US_VISITS } from '../shared/data.js';
import { escapeHtml } from '../../lib/html.js';
import { MAX_ZOOM, VISIT_COLORS } from './constants.js';
import { dayBounds, dayPoints } from './activities.js';
import { fitView, fitWorld, stopCamera, updateBasemap } from './camera.js';
import { geometryId, isVisitedShape, statePlaces } from './format.js';
import { scopeFrance, splitDateline } from './geometry.js';
import { updateRouteStyles } from './route-style.js';

// Country and US state outlines, and the camera moves that focus them.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

const CONTIGUOUS_US = [
  [24, -126],
  [50, -66]
];
// Territories and DC are not drawn as states.
const HIDDEN_STATES = ['11', '60', '66', '69', '72', '78'];
const ANTARCTICA = '010';
// Places too small to see at world zoom get a dot.
const TINY_COUNTRIES = [
  { id: '156', coords: [22.32, 114.17] },
  { id: '336', coords: [41.9029, 12.4534] }
];
const PAGE_TITLE = 'Travel — Ganesh';
const COUNTRY_MAX_ZOOM = 12;
const PHOTO_FLY_SECONDS = 1.1;
// Country framing (metres): an activity joins a place this close, bringing
// its points within POINT_RADIUS; places this close form a neighbourhood.
const PLACE_RADIUS = 80000;
const POINT_RADIUS = 100000;
const NEIGHBORHOOD_RADIUS = 65000;
// A neighbourhood with this share of the activity is framed alone.
const BUSIEST_SHARE = 0.6;
// Minimum framed extent around the center (degrees), and the margin around it.
const MIN_HALF_EXTENT = [0.035, 0.055];
const FRAME_PAD = 0.12;

/** @param {any} feature */
const stateId = feature => String(feature.id).padStart(2, '0');

/**
 * @param {any} feature
 * @returns {object}
 */
export function styleCountry(feature) {
  const id = String(feature.id),
    marked = isVisitedShape(id) || id === HOME_COUNTRY;
  if (id === ANTARCTICA) return { opacity: 0, fillOpacity: 0 };
  return {
    color: marked ? '#b6bdc2' : '#d9dde0',
    weight: marked ? 1 : 0.7,
    opacity: 1,
    fillColor: '#fafafa',
    fillOpacity: 0.95
  };
}

/**
 * @param {string | null} id
 * @param {any} feature
 */
function stateColor(id, feature) {
  if (id === stateId(feature)) return '#858e95';
  if (US_VISITS[stateId(feature)]) return '#b6bdc2';
  return '#d9dde0';
}

/**
 * Style function for state outlines; the selected state is drawn darker.
 * @param {AtlasContext} ctx
 * @returns {(feature: any) => object}
 */
export const stateStyle = ctx => feature => ({
  color: stateColor(ctx.state.currentState, feature),
  weight: ctx.state.currentState === stateId(feature) ? 1.5 : 0.7,
  fillOpacity: 0
});

/**
 * @param {AtlasContext} ctx
 * @param {any} states TopoJSON of US states.
 */
export function renderStates(ctx, states) {
  const features = topojson
    .feature(states, states.objects.states)
    .features.filter(feature => !HIDDEN_STATES.includes(stateId(feature)));
  ctx.labels.geography(features, 'state');
  ctx.layers.states = ctx.L.geoJSON(features, {
    pane: 'states',
    interactive: false,
    style: stateStyle(ctx),
    onEachFeature(feature, layer) {
      // States are scenery like countries: labels name them and the viewer zooms by hand.
      ctx.layers.stateShapes.set(stateId(feature), layer);
      layer.options.interactive = false;
    }
  }).addTo(ctx.map);
}

/**
 * @param {AtlasContext} ctx
 * @param {any[]} features
 */
function renderVisitShading(ctx, features) {
  ctx.L.geoJSON(
    features.filter(feature => isVisitedShape(feature.id)),
    {
      pane: 'visitShading',
      interactive: false,
      style: feature => ({
        stroke: false,
        fillColor: feature.id === HOME_COUNTRY ? VISIT_COLORS.home : VISIT_COLORS.visited,
        fillOpacity: 0.38
      })
    }
  ).addTo(ctx.map);
}

/** @param {AtlasContext} ctx */
function renderTinyCountries(ctx) {
  const { L } = ctx;
  const tiny = L.layerGroup();
  TINY_COUNTRIES.forEach(item => {
    L.marker(item.coords, {
      icon: L.divIcon({
        className: 'tiny-country',
        html: `<i style="background:${escapeHtml(VISIT_COLORS.visited)}"></i>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      }),
      interactive: false,
      keyboard: false
    }).addTo(tiny);
  });
  ctx.layers.tiny = tiny.addTo(ctx.map);
}

/**
 * Draws the countries, then adds the route and label groups above them.
 * @param {AtlasContext} ctx
 * @param {any} world TopoJSON of countries.
 */
export function renderWorld(ctx, world) {
  const { L, layers, map } = ctx;
  const features = topojson
    .feature(world, world.objects.countries)
    .features.map(splitDateline)
    .flatMap(scopeFrance);
  features.forEach(feature => {
    feature.id = String(feature.id);
  });
  ctx.labels.geography(features, 'country');
  renderVisitShading(ctx, features);
  layers.world = L.geoJSON(features, {
    pane: 'countries',
    style: styleCountry,
    onEachFeature(feature, layer) {
      // Countries are scenery: labels name them and the viewer zooms by hand.
      const id = String(feature.id);
      layers.countryShapes.set(id, layer);
      layer.options.interactive = false;
      layer.options.className = `country-shape ${isVisitedShape(id) ? 'visited-country' : ''}`;
    }
  }).addTo(map);
  renderTinyCountries(ctx);
  [layers.flights, layers.airports, layers.transport, layers.routes, layers.cities].forEach(group =>
    group.addTo(map)
  );
}

/**
 * The outline that frames a country: the selected state, the contiguous US or
 * the country's own shape.
 * @param {AtlasContext} ctx
 * @param {string} id
 */
function countryOutline(ctx, id) {
  const { currentState } = ctx.state;
  if (id !== HOME_COUNTRY) return ctx.layers.countryShapes.get(geometryId(id)).getBounds();
  if (currentState) return ctx.layers.stateShapes.get(currentState).getBounds();
  return ctx.L.latLngBounds(CONTIGUOUS_US);
}

/**
 * @typedef {object} Candidate A place or activity cluster the frame may include.
 * @property {number[]} coords
 * @property {number} weight
 * @property {number[][]} points
 */

/**
 * Adds a day's activity to the nearest place, or as a place of its own when
 * it lies inside the outline.
 * @param {AtlasContext} ctx
 * @param {Candidate[]} candidates
 * @param {any} day
 * @param {any} outline
 */
function addActivity(ctx, candidates, day, outline) {
  const { L } = ctx;
  const points = dayPoints(ctx, day);
  if (!points.length) return;
  const center = dayBounds(ctx, day).getCenter();
  const nearest = [...candidates].sort(
    (a, b) => center.distanceTo(a.coords) - center.distanceTo(b.coords)
  )[0];
  if (nearest && center.distanceTo(nearest.coords) < PLACE_RADIUS) {
    nearest.weight++;
    nearest.points.push(
      ...points.filter(point => L.latLng(point).distanceTo(nearest.coords) < POINT_RADIUS)
    );
  } else if (outline.contains(center)) {
    candidates.push({ coords: [center.lat, center.lng], weight: 1, points: [...points] });
  }
}

/**
 * The busiest neighbourhood's members when it holds most of the activity,
 * otherwise every candidate.
 * @param {any} L
 * @param {Candidate[]} candidates
 */
function framedCandidates(L, candidates) {
  const neighborhoods = candidates.map(seed => {
    const members = candidates.filter(
      candidate => L.latLng(seed.coords).distanceTo(candidate.coords) < NEIGHBORHOOD_RADIUS
    );
    return { members, weight: members.reduce((sum, member) => sum + member.weight, 0) };
  });
  neighborhoods.sort((a, b) => b.weight - a.weight);
  const busiest = neighborhoods[0],
    total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  return busiest.weight / total >= BUSIEST_SHARE ? busiest.members : candidates;
}

/**
 * Frames where the time was spent in a country: its places and activities,
 * or just the busiest neighbourhood when one dominates.
 * @param {AtlasContext} ctx
 * @param {string} id
 */
export function countryBounds(ctx, id) {
  const { L } = ctx,
    { currentState } = ctx.state;
  const outline = countryOutline(ctx, id);
  if (id === HOME_COUNTRY && !currentState) return outline;
  const places = currentState ? statePlaces(currentState) : COUNTRY_PLACES[id] || [];
  /** @type {Candidate[]} */
  const candidates = places.map(place => ({ ...place, weight: 1, points: [place.coords] }));
  ctx.state.journeys
    .filter(journey => journey.countries.includes(id))
    .forEach(journey =>
      (journey.days || []).forEach(day => addActivity(ctx, candidates, day, outline))
    );
  if (!candidates.length) return outline;
  const bounds = L.latLngBounds(
    framedCandidates(L, candidates).flatMap(candidate => candidate.points)
  );
  const center = bounds.getCenter(),
    [halfLat, halfLng] = MIN_HALF_EXTENT;
  bounds.extend([center.lat - halfLat, center.lng - halfLng]);
  bounds.extend([center.lat + halfLat, center.lng + halfLng]);
  return bounds.pad(FRAME_PAD);
}

/**
 * Frames a visited country, or a US state when one is selected.
 * @param {AtlasContext} ctx
 * @param {string} id
 * @param {boolean} [animate]
 */
export function focusCountry(ctx, id, animate = true) {
  const { layers, state } = ctx;
  ctx.photos.cancel();
  ctx.map.closePopup();
  state.currentCountry = id;
  state.activeDay = null;
  layers.world.eachLayer(layer => layer.closeTooltip());
  layers.states.eachLayer(layer => layer.closeTooltip());
  if (id !== HOME_COUNTRY) state.currentState = null;
  layers.states.setStyle(stateStyle(ctx));
  updateRouteStyles(ctx);
  ctx.status.textContent = '';
  fitView(ctx, countryBounds(ctx, id), COUNTRY_MAX_ZOOM, animate);
}

/**
 * Clears the selection and returns to the whole world.
 * @param {AtlasContext} ctx
 * @param {boolean} [animate]
 */
export function showWorld(ctx, animate = true) {
  const { layers, state } = ctx;
  ctx.photos.cancel();
  ctx.smoothZoom.finish();
  ctx.map.closePopup();
  state.currentCountry = null;
  state.currentState = null;
  layers.states.setStyle(stateStyle(ctx));
  state.activeDay = null;
  updateRouteStyles(ctx);
  ctx.status.textContent = '';
  document.title = PAGE_TITLE;
  layers.world.setStyle(styleCountry);
  if (animate) {
    stopCamera(ctx);
    fitWorld(ctx, true);
  }
  updateBasemap(ctx);
}

/**
 * Moves the camera to a photo or photo group for the photo viewer.
 * @param {AtlasContext} ctx
 * @param {any} target {coords, zoom} or {bounds, maxZoom}, with the photo's
 *   country and an optional `complete` callback for when the camera arrives.
 * @returns {() => void} Cancels the pending `complete` callback.
 */
export function focusPhoto(ctx, target) {
  const { L, map, state } = ctx;
  stopCamera(ctx);
  state.currentCountry = target.country || null;
  state.currentState = null;
  ctx.layers.states.setStyle(stateStyle(ctx));
  const complete = () => {
    map.off('moveend', complete);
    target.complete?.();
  };
  if (target.complete) map.once('moveend', complete);
  if (target.coords) {
    const coords = L.latLng(target.coords),
      zoom = Math.min(MAX_ZOOM, target.zoom);
    if (map.getCenter().equals(coords) && map.getZoom() === zoom) complete();
    else map.flyTo(coords, zoom, { duration: PHOTO_FLY_SECONDS });
  } else {
    fitView(ctx, target.bounds, target.maxZoom);
  }
  return () => map.off('moveend', complete);
}
