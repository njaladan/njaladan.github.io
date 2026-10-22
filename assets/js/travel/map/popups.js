import { ROUTE_MODES } from '../shared/data.js';
import { writeSetting } from '../../lib/storage.js';
import { TRANSPORT_COLOR } from './constants.js';
import { longestSegment } from './activities.js';
import { fitView, stopCamera } from './camera.js';
import { activityContent, transportContent } from './card-content.js';
import { middlePoint, overflowShift } from './geometry.js';
import { updateRouteStyles } from './route-style.js';

// Opening, stepping and panning route cards, and the clicks inside them.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

export const HINT_SEEN_KEY = 'route-hint-seen';
// Card margins inside the map: the top clears the toolbar.
const PAN_MARGINS = { x: { near: 20, far: 20 }, y: { near: 70, far: 20 } };
const PAN_SECONDS = 0.6;
const PAN_EASE = 0.25;
const CONNECTION_MAX_ZOOM = 6;

/**
 * @param {AtlasContext} ctx
 * @param {any} day
 * @param {any} journey
 * @param {any} [latlng] Where the card points; the route's midpoint by default.
 */
export function openActivity(ctx, day, journey, latlng) {
  const { itineraries, state } = ctx;
  itineraries.sync(itineraries.forActivity(day));
  state.activeDay = day.id;
  updateRouteStyles(ctx);
  ctx.activityPopup
    .setLatLng(latlng || ctx.cards.midpoint(longestSegment(ctx, day)))
    .setContent(activityContent(ctx, day, journey))
    .openOn(ctx.map);
}

/**
 * Pans only as far as needed to reveal a card that overflows the map.
 * @param {AtlasContext} ctx
 */
export function panRoutePopupIntoView(ctx) {
  const { activityPopup, map } = ctx;
  if (!activityPopup.isOpen()) return;
  const container = map.getContainer(),
    card = activityPopup.getElement().getBoundingClientRect(),
    view = container.getBoundingClientRect();
  // Leaflet resets browser scrolling caused by button focus; ignore that temporary offset.
  const left = card.left - view.left + container.scrollLeft,
    top = card.top - view.top + container.scrollTop;
  const x = overflowShift(left, card.width, view.width, PAN_MARGINS.x),
    y = overflowShift(top, card.height, view.height, PAN_MARGINS.y);
  // panBy keeps the zoom fixed, even for distant sections.
  if (x || y) {
    map.panBy([x, y], {
      animate: !ctx.reduceMotion,
      duration: PAN_SECONDS,
      easeLinearity: PAN_EASE
    });
  }
}

/**
 * Moves the open card to another day of the same trek.
 * @param {AtlasContext} ctx
 * @param {number} journeyIndex
 * @param {number} dayIndex
 */
export function stepActivity(ctx, journeyIndex, dayIndex) {
  const { activityPopup, state } = ctx;
  const journey = state.journeys[journeyIndex],
    day = journey?.days?.[dayIndex];
  if (!day) return;
  stopCamera(ctx);
  state.activeDay = day.id;
  updateRouteStyles(ctx);
  // Move the card to this section before deciding whether the camera must pan.
  const autoPan = activityPopup.options.autoPan;
  activityPopup.options.autoPan = false;
  try {
    activityPopup
      .setLatLng(ctx.cards.midpoint(longestSegment(ctx, day)))
      .setContent(activityContent(ctx, day, journey));
  } finally {
    activityPopup.options.autoPan = autoPan;
  }
  panRoutePopupIntoView(ctx);
}

/**
 * @param {AtlasContext} ctx
 * @param {any} trip A transport leg.
 * @param {any} [latlng]
 */
export function openTransport(ctx, trip, latlng) {
  const { itineraries } = ctx;
  ctx.state.activeDay = null;
  updateRouteStyles(ctx);
  itineraries.sync(itineraries.forTransport(trip));
  const color = ROUTE_MODES[trip.mode]?.color || TRANSPORT_COLOR;
  ctx.activityPopup
    .setLatLng(latlng || ctx.cards.midpoint(trip.coords))
    .setContent(transportContent(ctx, trip, color))
    .openOn(ctx.map);
}

/**
 * Flies to a flight connection listed on an airport card and opens its card.
 * @param {AtlasContext} ctx
 * @param {number} index
 */
export function openConnection(ctx, index) {
  const { L, map } = ctx;
  const connection = ctx.state.flightLog.routes[index];
  const line = ctx.layers.flightLines[index],
    segment = connection?.segments[0];
  if (!line || !segment) return;
  map.closePopup();
  map.once('moveend', () => line.openPopup(L.latLng(middlePoint(segment))));
  fitView(ctx, L.latLngBounds(connection.segments.flat()), CONNECTION_MAX_ZOOM);
}

/**
 * Handles a click inside a route card: photos, connections, itineraries and
 * the trek stepper.
 * @param {AtlasContext} ctx
 * @param {Element} target
 */
function cardClick(ctx, target) {
  const print = /** @type {HTMLElement | null} */ (target.closest('.route-card [data-photo]'));
  if (print) {
    ctx.photos.show([print.dataset.photo]);
    return;
  }
  const connection = /** @type {HTMLElement | null} */ (
    target.closest('.route-card [data-connection]')
  );
  if (connection) {
    openConnection(ctx, Number(connection.dataset.connection));
    return;
  }
  const itinerary = /** @type {HTMLElement | null} */ (
    target.closest('.route-card [data-itinerary]')
  );
  if (itinerary) {
    ctx.itineraries.open(itinerary.dataset.itinerary, Number(itinerary.dataset.tripStep));
    return;
  }
  const step = /** @type {HTMLElement | null} */ (target.closest('.route-card [data-step]')),
    card = /** @type {HTMLElement | null} */ (step?.closest('.route-card'));
  if (step && card) {
    stepActivity(
      ctx,
      Number(card.dataset.journey),
      Number(card.dataset.day) + Number(step.dataset.step)
    );
  }
}

/**
 * Clears the route selection when its card closes, retires the route hint
 * once a card has been seen, and handles clicks inside cards.
 * @param {AtlasContext} ctx
 */
export function installPopupEvents(ctx) {
  const { map } = ctx;
  map.on('popupclose', event => {
    if (event.popup === ctx.activityPopup) {
      ctx.state.activeDay = null;
      updateRouteStyles(ctx);
    }
  });
  map.on('popupopen', event => {
    if (!event.popup.getElement()?.querySelector('.route-card')) return;
    ctx.hint.hidden = true;
    writeSetting(HINT_SEEN_KEY, '1');
  });
  map
    .getContainer()
    .addEventListener('click', event => cardClick(ctx, /** @type {Element} */ (event.target)));
}
