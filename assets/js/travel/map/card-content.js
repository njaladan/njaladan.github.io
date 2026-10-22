import { ROUTE_MODES } from '../shared/data.js';
import { escapeHtml } from '../../lib/html.js';
import { ROUTE_COLORS } from './constants.js';
import { dayPoints, longestSegment } from './activities.js';
import { nearestPlace } from './geometry.js';
import {
  TREKS,
  activityNoun,
  activityQuote,
  activityTitle,
  airline,
  allPlaces,
  clock,
  countriesLabel,
  formatDuration,
  plural,
  transportHeading
} from './format.js';

// HTML for route cards, built with routes/card-html.js's shared layout.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */
/** @typedef {[string | number, string] | { distanceKm: number, precision: number }} Stat */

// A title names the nearest known place within this distance (km).
const PLACE_RADIUS_KM = 30;
// Cards show photos taken within this distance (km) of the route.
const ACTIVITY_PHOTO_KM = 1.5;
const TRANSPORT_PHOTO_KM = 3;

/**
 * The activity's title, naming the nearest place when there is one.
 * @param {AtlasContext} ctx
 * @param {any} day
 * @param {any} journey
 */
export function activityLabel(ctx, day, journey) {
  const { cards } = ctx;
  return activityTitle(
    day,
    journey,
    () =>
      nearestPlace(
        cards.midpoint(longestSegment(ctx, day)),
        allPlaces(),
        cards.haversine,
        PLACE_RADIUS_KM
      )?.name || null
  );
}

/**
 * @param {AtlasContext['cards']} cards
 * @param {any} day
 * @returns {Stat[]}
 */
function activityStats(cards, day) {
  /** @type {Stat[]} */
  const stats = [];
  if (Number.isFinite(day.distance_m)) stats.push(cards.distance(day.distance_m / 1000, 1));
  if (Number.isFinite(day.elapsed_s)) stats.push([clock(day.elapsed_s), 'Hours']);
  if (Number.isFinite(day.elevation_m)) {
    stats.push([Math.round(day.elevation_m).toLocaleString(), 'Climb m']);
  }
  return stats;
}

/**
 * The card's context line: the trip day, or the day within a trek.
 * @param {any} trip The itinerary card, if the activity belongs to a trip.
 * @param {string | undefined} trek
 * @param {number} index
 * @param {number} total
 */
function activityContext(trip, trek, index, total) {
  if (trip) return `Day ${trip.index + 1} of ${trip.steps.length}`;
  if (trek && total > 1) return `${index + 1} of ${total} · ${trek}`;
  return '';
}

/**
 * @param {AtlasContext} ctx
 * @param {any} day
 * @param {any} journey
 * @returns {string}
 */
export function activityContent(ctx, day, journey) {
  const { cards, itineraries, state } = ctx;
  const trek = TREKS[journey.id],
    days = journey.days || [],
    index = days.indexOf(day);
  const trip = itineraries.card(itineraries.forActivity(day));
  return cards.html({
    modeKey: day.type,
    modeName: activityNoun(day.type),
    color: ROUTE_MODES[day.type]?.color || ROUTE_COLORS[0],
    context: activityContext(trip, trek, index, days.length),
    title: trek && trip ? trip.title : activityLabel(ctx, day, journey),
    quote: activityQuote(day, trek),
    subtitle: countriesLabel(day.countries),
    stats: activityStats(cards, day),
    photos: cards.photosNear(state.allPhotos, dayPoints(ctx, day), ACTIVITY_PHOTO_KM),
    trip,
    // Trip days are browsed in the itinerary panel; only a trek without one steps here.
    stepper: !trip && trek && days.length > 1 ? { index, total: days.length } : null,
    attrs: `data-journey="${escapeHtml(state.journeys.indexOf(journey))}" data-day="${escapeHtml(index)}"`
  });
}

/**
 * Outbound and return services of a bus with a return leg.
 * @param {any} trip
 */
function busServices(trip) {
  const bus = trip.bus || {};
  return [bus, bus.return_service].map((service, index) => ({
    title: `To ${index ? service.destination : trip.stops[trip.stops.length - 1]}`,
    subtitle: (index ? service.operator : trip.operator) || '',
    duration: Number.isFinite(service.scheduled_duration_s)
      ? formatDuration(service.scheduled_duration_s).replace(/ 0m$/, '')
      : ''
  }));
}

/**
 * @param {AtlasContext} ctx
 * @param {any} trip
 * @param {{ color: string, title: string, context: string[] }} heading
 */
function busContent(ctx, trip, { color, title, context }) {
  const { cards } = ctx;
  const bus = trip.bus || {},
    returnService = bus.return_service;
  /** @type {Stat[]} */
  const stats = [cards.distance(cards.km(trip.coords))];
  if (!returnService && Number.isFinite(bus.scheduled_duration_s)) {
    stats.push([clock(bus.scheduled_duration_s), 'Hours']);
  }
  return cards.html({
    modeKey: 'Bus',
    modeName: 'Bus',
    color,
    title: returnService ? title.replace('→', '↔') : title,
    subtitle: [...context, ...(!returnService && trip.operator ? [trip.operator] : [])]
      .filter(Boolean)
      .join(' · '),
    services: returnService ? busServices(trip) : [],
    stats,
    photos: cards.photosNear(ctx.state.allPhotos, trip.coords, TRANSPORT_PHOTO_KM)
  });
}

/**
 * @param {AtlasContext} ctx
 * @param {any} trip A transport leg.
 * @param {string} color
 * @returns {string}
 */
export function transportContent(ctx, trip, color) {
  const { cards, itineraries } = ctx;
  const itinerary = itineraries.card(itineraries.forTransport(trip));
  const { title, context } = transportHeading(trip);
  if (trip.mode === 'Bus') return busContent(ctx, trip, { color, title, context });
  const details = [...context, trip.operator, trip.vessel, countriesLabel(trip.countries)].filter(
    Boolean
  );
  /** @type {Stat[]} */
  const stats = [cards.distance(cards.km(trip.coords))];
  if (trip.stops.length > 2) stats.push([trip.stops.length, 'Stops']);
  if (trip.countries?.length > 1) stats.push([trip.countries.length, 'Countries']);
  return cards.html({
    modeKey: trip.mode,
    modeName: trip.mode,
    color,
    title,
    subtitle: details.join(' · '),
    stops: trip.stops,
    stats,
    photos: cards.photosNear(ctx.state.allPhotos, trip.coords, TRANSPORT_PHOTO_KM),
    trip: itinerary,
    context: itinerary ? `Day ${itinerary.index + 1} of ${itinerary.steps.length}` : ''
  });
}

/**
 * Card for a connection between two airports, listing every flight on it.
 * @param {AtlasContext} ctx
 * @param {any} connection
 * @returns {string}
 */
export function flightContent(ctx, connection) {
  const { cards } = ctx,
    { flightLog } = ctx.state;
  const records = connection.flights.map(index => flightLog.flights[index]),
    first = records[0];
  const from = flightLog.airports[first.from],
    to = flightLog.airports[first.to],
    both = records.some(flight => flight.from === first.to);
  const arrow = both ? '↔' : '→';
  const timed = records.filter(flight => flight.duration_s);
  /** @type {Stat[]} */
  const stats = [cards.distance(cards.haversine(from.coords, to.coords))];
  if (timed.length) {
    stats.push([
      clock(timed.reduce((sum, flight) => sum + flight.duration_s, 0) / timed.length),
      'In the air'
    ]);
  }
  stats.push([`${records.length}×`, 'Flown']);
  return cards.html({
    modeKey: 'Flight',
    modeName: 'Flight',
    color: ROUTE_MODES.Flight.color,
    title: `${first.from} ${arrow} ${first.to}`,
    subtitle: `${from.city} ${arrow} ${to.city}`,
    stats,
    rows: records.map(flight => ({
      cells: [
        airline(flight.number),
        `${flight.from} → ${flight.to}`,
        flight.duration_s ? formatDuration(flight.duration_s) : ''
      ]
    }))
  });
}

/**
 * Card for an airport, listing its connections busiest first.
 * @param {AtlasContext} ctx
 * @param {string} code
 * @returns {string}
 */
export function airportContent(ctx, code) {
  const { flightLog } = ctx.state;
  const airport = flightLog.airports[code],
    routes = flightLog.routes
      .map((connection, index) => ({ connection, index }))
      .filter(({ connection }) => connection.airports.includes(code));
  const flights = routes.reduce((sum, { connection }) => sum + connection.flights.length, 0);
  routes.sort((a, b) => b.connection.flights.length - a.connection.flights.length);
  return ctx.cards.html({
    modeKey: 'Flight',
    modeName: 'Airport',
    color: ROUTE_MODES.Flight.color,
    title: `${code} · ${airport.city}`,
    subtitle: airport.name,
    stats: [
      [flights, plural(flights, 'Flight', 'Flights')],
      [routes.length, plural(routes.length, 'Destination', 'Destinations')]
    ],
    rowsLabel: 'View a connection',
    rows: routes.map(({ connection, index }) => {
      const other = connection.airports.find(item => item !== code) || code,
        city = flightLog.airports[other]?.city;
      const label = `View connection: ${code} ↔ ${other} · ${city || other}`;
      return {
        cells: [other, city || '', `${connection.flights.length}×`],
        attrs: `type="button" data-connection="${escapeHtml(index)}" aria-label="${escapeHtml(label)}"`
      };
    })
  });
}
