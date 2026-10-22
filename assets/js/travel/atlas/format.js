import { COUNTRY_PLACES, HOME_COUNTRY, US_VISITS, VISITED_COUNTRIES } from '../data.js';

// Text for cards, labels and titles. Pure functions of the travel records.

/**
 * @typedef {object} Place
 * @property {string} name
 * @property {number[]} coords
 * @property {string} [country]
 * @property {string} [state]
 * @property {boolean} [park]
 */

const AIRLINES = {
  DL: 'Delta',
  UA: 'United',
  WN: 'Southwest',
  B6: 'JetBlue',
  AA: 'American',
  NK: 'Spirit',
  LA: 'LATAM',
  F9: 'Frontier',
  DY: 'Norwegian',
  FR: 'Ryanair',
  CX: 'Cathay Pacific',
  AS: 'Alaska',
  FI: 'Icelandair',
  TK: 'Turkish Airlines',
  AI: 'Air India',
  BA: 'British Airways',
  PD: 'Porter',
  LX: 'Swiss',
  A3: 'Aegean',
  RJ: 'Royal Jordanian',
  VB: 'Viva Aerobus',
  W9: 'Wizz Air',
  W4: 'Wizz Air',
  EC: 'easyJet',
  '6E': 'IndiGo'
};
// Treks keep their recorded day titles; other activity titles name the place.
export const TREKS = { tmb: 'Tour du Mont Blanc', 'chile-activities': 'W Trek' };
const ACTIVITY_NOUNS = { hiking: 'Hike', walking: 'Walk', running: 'Run', cycling: 'Bike ride' };
// Strava's default names say nothing a card title does not.
const GENERIC_NAME = /^(morning|lunch|afternoon|evening|night) (walk|hike|ride|run|e-bike ride)$/i;

/**
 * Hong Kong's outline (344) belongs to the Hong Kong SAR record (156).
 * @param {string | null} id
 * @returns {string | null}
 */
export const canonical = id => (id === '344' ? '156' : id);
/** @param {string} id */
export const allowed = id => Boolean(VISITED_COUNTRIES[id]) || id === HOME_COUNTRY;
/** @param {string} id */
export const geometryId = id => VISITED_COUNTRIES[id]?.geometry || id;
/** @param {string} id */
export const isVisitedShape = id => id !== '156' && allowed(canonical(id));

/**
 * @param {string} id
 * @returns {string}
 */
export function countryName(id) {
  if (id === HOME_COUNTRY) return 'United States';
  const { name, scope } = VISITED_COUNTRIES[id];
  return scope ? `${name} · ${scope}` : name;
}

/**
 * Visited country names joined for a card subtitle.
 * @param {string[] | undefined} ids
 */
export const countriesLabel = ids =>
  (ids || []).map(canonical).filter(allowed).map(countryName).join(' · ');

/**
 * @param {number} seconds
 * @returns {string} e.g. "45m" or "2h 5m"
 */
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * @param {number} seconds
 * @returns {string} e.g. "2:05"
 */
export function clock(seconds) {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Prefixes a flight number with its airline's name when known.
 * @param {string} number
 */
export function airline(number) {
  const name = AIRLINES[number.slice(0, 2)];
  return name ? `${name} ${number}` : number;
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
export const plural = (count, one, many) => (count === 1 ? one : many);

/** @param {string} type */
export const activityNoun = type => ACTIVITY_NOUNS[type] || 'Activity';

/**
 * The Strava name, quoted on the card, unless it is a default name or a trek day.
 * @param {{ name?: string }} day
 * @param {string | undefined} trek
 */
export const activityQuote = (day, trek) =>
  !trek && day.name && !GENERIC_NAME.test(day.name) ? day.name : '';

/**
 * Titles say what and where. `findPlace` names the nearest known place, if any;
 * it runs only when the title needs it.
 * @param {{ name?: string, type: string, countries?: string[] }} day
 * @param {{ id: string, days?: object[] }} journey
 * @param {() => string | null} findPlace
 * @returns {string}
 */
export function activityTitle(day, journey, findPlace) {
  const trek = TREKS[journey.id];
  if (trek) {
    return journey.id === 'tmb'
      ? (day.name || '').replace(/^TMB/, trek)
      : `${trek} · Day ${(journey.days || []).indexOf(day) + 1}`;
  }
  const noun = activityNoun(day.type),
    place = findPlace();
  if (place) return `${noun} ${day.type === 'hiking' ? 'near' : 'in'} ${place}`;
  const country = (day.countries || [])
    .map(canonical)
    .filter(allowed)
    .map(id => VISITED_COUNTRIES[id]?.name || countryName(id))[0];
  if (!country) return noun;
  return `${noun} in ${/^(United|Netherlands)/.test(country) ? 'the ' : ''}${country}`;
}

/**
 * Names like "Chamonix → Courmayeur · Skyway" keep the arrow part as the title
 * and the rest as context; other names become context under a first → last title.
 * @param {{ name: string, stops: string[] }} trip
 * @returns {{ title: string, context: string[] }}
 */
export function transportHeading(trip) {
  const [head, ...rest] = trip.name.split(' · ');
  if (/[→↔]/.test(head)) return { title: head, context: rest };
  return { title: `${trip.stops[0]} → ${trip.stops[trip.stops.length - 1]}`, context: [trip.name] };
}

/**
 * Cities and national parks visited in a US state.
 * @param {string} id
 * @returns {Place[]}
 */
export function statePlaces(id) {
  const visit = US_VISITS[id];
  return [
    ...visit.cities.map(([name, lat, lon]) => ({ name, coords: [lat, lon], state: id })),
    ...visit.parks.map(([name, lat, lon]) => ({ name, coords: [lat, lon], park: true, state: id }))
  ];
}

/** @returns {Place[]} Every labelled place: country places first, then US states. */
export const allPlaces = () => [
  ...Object.entries(COUNTRY_PLACES).flatMap(([country, places]) =>
    places.map(place => ({ ...place, country }))
  ),
  ...Object.keys(US_VISITS).flatMap(statePlaces)
];

/**
 * Reads `#country=…&state=…`. `country` is null for the world view; `invalid`
 * marks a country the atlas does not show, whose hash should be cleared.
 * @param {string} hash
 * @returns {{ country: string | null, state: string | null, invalid: boolean }}
 */
export function parseAtlasHash(hash) {
  const params = new URLSearchParams(hash.slice(1));
  const raw = params.get('country'),
    state = params.get('state');
  const id = canonical(raw);
  const country = id && allowed(id) ? id : null;
  return {
    country,
    state: raw === HOME_COUNTRY && US_VISITS[state] ? state : null,
    invalid: Boolean(raw) && !country
  };
}

/**
 * Photos that can sit on the map and in cards: located, with a thumbnail.
 * @param {unknown} photos
 * @returns {any[]}
 */
export const mappablePhotos = photos =>
  (Array.isArray(photos) ? photos : []).filter(
    photo => Array.isArray(photo?.coords) && photo.variants?.thumbnail?.src
  );
