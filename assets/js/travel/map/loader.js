import { travelAsset } from '../shared/runtime.js';

// Fetches the atlas data. Optional files fall back to their empty value; any
// other failure stops the map.

/**
 * @param {string} file
 * @param {object} [fallback] Returned, with a warning, when the file fails to load.
 * @returns {Promise<any>}
 */
function loadJSON(file, fallback) {
  const request = fetch(travelAsset(`data/travel/${file}`)).then(response => {
    if (!response.ok) throw Error(`${file} unavailable`);
    return response.json();
  });
  if (!fallback) return request;
  return request.catch(error => {
    console.warn(error);
    return fallback;
  });
}

/**
 * @typedef {object} AtlasData
 * @property {any} context Basemap context: cities to label.
 * @property {any} states TopoJSON of US states.
 * @property {any} world TopoJSON of countries.
 * @property {any} activities Recorded journeys.
 * @property {any} connections Transport legs.
 * @property {import('./context.js').FlightLog} flights
 * @property {{ photos?: any[], unavailable?: boolean }} photos
 * @property {any} itineraries Trip definitions.
 */

/** @returns {Promise<AtlasData>} */
export async function loadAtlasData() {
  const [context, states, world, activities, connections, flights, photos, itineraries] =
    await Promise.all([
      loadJSON('context.json'),
      loadJSON('us-states.json'),
      loadJSON('world.json'),
      loadJSON('activities.json'),
      loadJSON('transport.json'),
      loadJSON('flights.json'),
      loadJSON('photos.json', { photos: [], unavailable: true }),
      loadJSON('itineraries.json', { trips: [] })
    ]);
  return { context, states, world, activities, connections, flights, photos, itineraries };
}
