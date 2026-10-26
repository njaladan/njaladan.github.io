// The atlas's shared objects and mutable state. app.js creates one context and
// passes it to every module, so all state lives in one visible place.

/**
 * @typedef {object} FlightLog
 * @property {Record<string, any>} airports Airports by IATA code.
 * @property {any[]} flights
 * @property {any[]} routes Connections between two airports.
 */

/**
 * @typedef {object} RouteEntry
 * @property {string} mode
 * @property {any[]} bounds
 * @property {any[]} layers
 * @property {any} [badge]
 */

/**
 * @typedef {object} CityMarker
 * @property {any} marker
 * @property {import('./format.js').Place} city
 * @property {import('./geometry.js').Size} [labelSize]
 */

/**
 * @typedef {object} AtlasState
 * @property {string | null} currentCountry
 * @property {string | null} currentState
 * @property {unknown} activeDay Id of the activity whose card is open.
 * @property {boolean} cameraMoving
 * @property {any[]} journeys
 * @property {any[]} transport
 * @property {FlightLog} flightLog
 * @property {any[]} allPhotos Photos with coordinates and a thumbnail.
 * @property {ReturnType<typeof setTimeout> | null} labelTimer
 * @property {number | null} routeFrame
 * @property {number[] | null} panelShift How far the map slid for the open panel.
 * @property {Element[]} hotRoutes Routes lifted by an itinerary hover.
 */

/**
 * @typedef {object} AtlasLayers
 * @property {Map<string, any>} countryShapes Country outlines by geometry id.
 * @property {Map<string, any>} stateShapes US state outlines by FIPS code.
 * @property {any} world Country layer; set once the data has loaded.
 * @property {any} states
 * @property {any} tiny Markers for countries too small to see.
 * @property {any} detail
 * @property {any} routes
 * @property {any} transport
 * @property {any} cities
 * @property {any} flights
 * @property {any} airports
 * @property {any} badges
 * @property {{ id: unknown, color: string, outline: any, line: any }[]} tracks
 * @property {CityMarker[]} cityMarkers
 * @property {{ marker: any, flights: number }[]} airportMarkers
 * @property {any[]} flightLines Flight lines by connection index.
 * @property {any[]} hitLines
 * @property {{ transport: RouteEntry[], activities: RouteEntry[], flights: RouteEntry[] }} routeEntries
 * @property {Map<string, () => Element[]>} routeHover Route elements by `kind:id`.
 * @property {WeakMap<object, { segments: number[][][], points: number[][], bounds: any }>} activityGeometry
 */

/**
 * @typedef {object} AtlasContext
 * @property {any} L Leaflet, or the globe renderer's Leaflet-like API.
 * @property {any} map
 * @property {{ finish: () => void }} smoothZoom
 * @property {ReturnType<typeof import('../routes/index.js').installRouteCards>} cards
 * @property {any} photos
 * @property {any} itineraries
 * @property {any} labels Basemap labels.
 * @property {any} CityTooltip
 * @property {any} activityPopup
 * @property {HTMLElement} hint
 * @property {HTMLElement} legend
 * @property {HTMLElement} status
 * @property {HTMLDialogElement | null} settings
 * @property {AtlasState} state
 * @property {AtlasLayers} layers
 */

/**
 * Creates the context with empty state and the layer groups the map fills.
 * Renderer objects (map, cards, photos…) are attached as app.js installs them.
 * @param {any} L
 * @param {{ legend: HTMLElement, status: HTMLElement }} elements
 * @returns {AtlasContext}
 */
export function createContext(L, { legend, status }) {
  return /** @type {AtlasContext} */ ({
    L,
    legend,
    status,
    state: {
      currentCountry: null,
      currentState: null,
      activeDay: null,
      cameraMoving: false,
      journeys: [],
      transport: [],
      flightLog: { airports: {}, flights: [], routes: [] },
      allPhotos: [],
      labelTimer: null,
      routeFrame: null,
      panelShift: null,
      hotRoutes: []
    },
    layers: {
      countryShapes: new Map(),
      stateShapes: new Map(),
      world: null,
      states: null,
      tiny: null,
      detail: null,
      routes: L.layerGroup(),
      transport: L.layerGroup(),
      cities: L.layerGroup(),
      flights: L.layerGroup(),
      airports: L.layerGroup(),
      badges: null,
      tracks: [],
      cityMarkers: [],
      airportMarkers: [],
      flightLines: [],
      hitLines: [],
      routeEntries: { transport: [], activities: [], flights: [] },
      routeHover: new Map(),
      activityGeometry: new WeakMap()
    }
  });
}
