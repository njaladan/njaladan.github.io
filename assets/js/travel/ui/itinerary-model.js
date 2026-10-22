import { haversine, nearestKm, pathKm } from './geo.js';

// Trip itineraries as plain data: building days from saved definitions,
// choosing the points a view fits to, and assigning photos to days.
// Side-effect free, so the unit tests import it directly.

const TRIP_ID = /^[a-z0-9-]+$/;
// A padded box (about 45 km) skips the distance scan for far-off photos.
const PHOTO_BOX_PAD = { lat: 0.4, lng: 0.8 };
// Undated photos match within these radii (km): tight for trails, wider for
// transport days, widest for days that only list places.
const PHOTO_RADIUS_KM = { trail: 2, transport: 4, places: 15 };
// Dated photos match a same-dated day anywhere near its route.
const DATED_PHOTO_RADIUS_KM = 40;

/**
 * @typedef {{kind: 'activity' | 'transport' | 'flight', id: string, mode: string, title: string,
 *   detail?: string, distanceKm: number | null, elapsed?: number, elevation?: number}} Leg
 * @typedef {{name: string, coords: number[]}} Place
 * @typedef {{label: string, title: string, date: string | null, legs: Leg[], places: Place[]}} Day
 * @typedef {{id: string, title: string, note?: string, fit?: string, noun: string, days: Day[],
 *   steps: Day[], index: number}} Trip
 * @typedef {{trip: Trip, index: number}} TripRef
 * @typedef {(leg: Leg) => number[][]} LegGeometry
 */

/** @returns {(item: any) => Leg[]} */
function legResolver(activities, routes, flightLog) {
  return item => {
    if (item.activity) {
      const activity = activities.get(item.activity);
      if (!activity) return [];
      return [
        {
          kind: 'activity',
          id: activity.id,
          mode: activity.type,
          title: item.name || activity.name || 'Activity',
          distanceKm: Number.isFinite(activity.distance_m) ? activity.distance_m / 1000 : null,
          elapsed: activity.elapsed_s,
          elevation: activity.elevation_m
        }
      ];
    }
    if (item.flight) {
      const [from, to] = item.flight.map(code => flightLog.airports?.[code]);
      if (!from || !to) return [];
      // A flight leg names its connection by sorted airport codes, as the map draws it.
      return [
        {
          kind: 'flight',
          id: [...item.flight].sort().join('-'),
          mode: 'Flight',
          title: item.name || `${from.city} → ${to.city}`,
          detail: item.flight.join(' → '),
          distanceKm: haversine(from.coords, to.coords)
        }
      ];
    }
    const record = routes.get(item.route);
    if (!record) return [];
    return [
      {
        kind: 'transport',
        id: record.id,
        mode: record.mode,
        title: item.name || record.name.split(' · ')[0],
        distanceKm: pathKm(record.coords)
      }
    ];
  };
}

/**
 * Days of one trip definition that have legs or places, numbered by position.
 * @param {any[]} sources
 * @param {(item: any) => Leg[]} resolveLeg
 * @returns {Day[]}
 */
function buildDays(sources, resolveLeg) {
  return sources
    .map((source, number) => ({
      label: `Day ${number + 1}`,
      title: source.title || '',
      date: source.date || null,
      legs: (source.legs || []).flatMap(resolveLeg),
      places: (source.places || []).filter(place => place?.name && Array.isArray(place.coords))
    }))
    .filter(day => day.legs.length || day.places.length);
}

/**
 * Builds trips from saved definitions, linking legs to activity and transport
 * records. Each record refers back to the first trip day that uses it.
 * @param {{trips?: any[]} | null | undefined} definitions
 * @param {{journeys: any[], transport: any[], flightLog?: any}} records
 */
export function buildTrips(
  definitions,
  { journeys, transport, flightLog = { airports: {}, routes: [] } }
) {
  /** @type {Map<string, Trip>} */
  const trips = new Map();
  /** @type {Map<string, TripRef>} */
  const activityRefs = new Map();
  /** @type {Map<string, TripRef>} */
  const transportRefs = new Map();
  const activities = new Map(
    journeys.flatMap(journey => (journey.days || []).map(record => [record.id, record]))
  );
  const routes = new Map(transport.map(record => [record.id, record]));
  const resolveLeg = legResolver(activities, routes, flightLog);
  (definitions?.trips || []).forEach(definition => {
    if (!TRIP_ID.test(definition.id) || !Array.isArray(definition.days)) return;
    const days = buildDays(definition.days, resolveLeg);
    if (!days.length) return;
    const trip = { ...definition, noun: 'day', days, steps: days, index: 0 };
    trips.set(trip.id, trip);
    days.forEach((day, index) =>
      day.legs
        .filter(leg => leg.kind !== 'flight')
        .forEach(leg => {
          const refs = leg.kind === 'activity' ? activityRefs : transportRefs;
          if (!refs.has(leg.id)) refs.set(leg.id, { trip, index });
        })
    );
  });
  return { trips, activityRefs, transportRefs };
}

/** @param {Day} day @returns {string[]} distinct modes in leg order */
export const dayModes = day => [...new Set(day.legs.map(leg => leg.mode))];

/** @param {Trip} trip @returns {string[]} */
export const tripModes = trip => [...new Set(trip.days.flatMap(dayModes))];

/**
 * @param {Day} day
 * @param {LegGeometry} geometry
 * @param {(leg: Leg) => boolean} [include]
 */
export const dayPoints = (day, geometry, include = () => true) => [
  ...day.legs.filter(include).flatMap(leg => geometry(leg)),
  ...day.places.map(place => place.coords)
];

// Long-haul flights would zoom a whole trip out to a continent and pull in
// photos from far away, so trip views and photo matching use the ground legs.
/** @param {Day} day @param {LegGeometry} geometry */
export const groundPoints = (day, geometry) =>
  dayPoints(day, geometry, leg => leg.kind !== 'flight');

// Hiking trips fit to the trail itself, so a long bus or taxi transfer to the
// trailhead doesn't zoom the overview out.
/** @param {Day} day @param {LegGeometry} geometry */
const trailPoints = (day, geometry) => dayPoints(day, geometry, leg => leg.kind === 'activity');

/**
 * Points a whole-trip view fits to.
 * @param {Trip} trip
 * @param {LegGeometry} geometry
 * @returns {number[][]}
 */
export function tripPoints(trip, geometry) {
  const trail =
    trip.fit === 'activities' ? trip.days.flatMap(day => trailPoints(day, geometry)) : [];
  if (trail.length) return trail;
  const points = trip.days.flatMap(day => groundPoints(day, geometry));
  return points.length ? points : trip.days.flatMap(day => dayPoints(day, geometry));
}

/** Kilometres covered on foot (by activities) in a day. */
export const onFootKm = day =>
  day.legs
    .filter(leg => leg.kind === 'activity' && Number.isFinite(leg.distanceKm))
    .reduce((sum, leg) => sum + leg.distanceKm, 0);

/** @param {Day} day */
function photoRadius(day) {
  if (day.legs.some(leg => leg.kind === 'activity')) return PHOTO_RADIUS_KM.trail;
  return day.legs.length ? PHOTO_RADIUS_KM.transport : PHOTO_RADIUS_KM.places;
}

/** @param {Day} day @param {LegGeometry} geometry */
function dayShape(day, geometry) {
  const points = groundPoints(day, geometry);
  const lats = points.map(point => point[0]),
    lngs = points.map(point => point[1]);
  return {
    day,
    points,
    box: [
      Math.min(...lats) - PHOTO_BOX_PAD.lat,
      Math.max(...lats) + PHOTO_BOX_PAD.lat,
      Math.min(...lngs) - PHOTO_BOX_PAD.lng,
      Math.max(...lngs) + PHOTO_BOX_PAD.lng
    ],
    radius: photoRadius(day)
  };
}

/** Index of the closest matching day shape for a photo, or -1. */
function bestDay(photo, shapes) {
  let best = -1,
    bestDistance = Infinity;
  const [lat, lng] = photo.coords;
  shapes.forEach(({ day, points, box, radius }, index) => {
    if (!points.length || lat < box[0] || lat > box[1] || lng < box[2] || lng > box[3]) return;
    const d = nearestKm(photo.coords, points);
    const matches =
      photo.date && day.date ? photo.date === day.date && d < DATED_PHOTO_RADIUS_KM : d < radius;
    if (matches && d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * Each photo belongs to at most one day: a dated photo to the same-dated day
 * nearby, an undated one to the closest day whose route passes close by.
 * @template {{coords: number[], date?: string}} P
 * @param {Trip} trip
 * @param {P[]} photos
 * @param {LegGeometry} geometry
 * @returns {P[][]} photos per day, in input order
 */
export function assignDayPhotos(trip, photos, geometry) {
  const days = trip.days.map(() => []);
  const shapes = trip.days.map(day => dayShape(day, geometry));
  photos.forEach(photo => {
    const best = bestDay(photo, shapes);
    if (best >= 0) days[best].push(photo);
  });
  return days;
}

/**
 * The list rotated to start at `index`, so a viewer opened there can step through all.
 * @template T
 * @param {T[]} list
 * @param {number} index
 * @returns {T[]}
 */
export const rotate = (list, index) => [...list.slice(index), ...list.slice(0, index)];
