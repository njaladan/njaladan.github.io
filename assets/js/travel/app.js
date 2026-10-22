import { ROUTE_MODES } from './data.js';
import { $ } from '../lib/dom.js';
import { installSmoothZoom } from './smooth-zoom.js';
import { installBasemapLabels } from './basemap-labels.js';
import { installRouteCards } from './route-cards.js';
import { installTripItineraries } from './itineraries.js';
import { installAtlasPhotos } from './photos.js';
import { globeRenderer, globeSupported } from './globe.js';
import { createContext } from './atlas/context.js';
import { CARD_OPTIONS } from './atlas/constants.js';
import {
  addAttributions,
  createDetailLayer,
  createMap,
  createPanes,
  fitWorld
} from './atlas/camera.js';
import { installSettings } from './atlas/settings.js';
import { focusPhoto, renderStates, renderWorld } from './atlas/countries.js';
import { createCityTooltip, declutterLabels, renderCities } from './atlas/labels.js';
import { fitBesidePanel, legPoints, panelToggled } from './atlas/panel.js';
import { highlightRoutes } from './atlas/route-style.js';
import { installPopupEvents } from './atlas/popups.js';
import {
  createRouteHint,
  queueRouteAnimations,
  renderRoutes,
  renderTransport,
  updateBadges
} from './atlas/routes.js';
import { renderFlights } from './atlas/flights.js';
import { mappablePhotos } from './atlas/format.js';
import { applyDeepLink, applyHash, installEscapeKeys } from './atlas/router.js';
import { installViewEvents } from './atlas/view-events.js';
import { loadAtlasData } from './atlas/loader.js';

// The travel atlas: wires the map, its layers and panels together. Each
// module under atlas/ takes the shared context created here.

/** @typedef {import('./atlas/context.js').AtlasContext} AtlasContext */

const L = globeRenderer || window.L;

/**
 * Creates the map with its panes, basemap labels and photo pins.
 * @param {AtlasContext} ctx
 */
function installMap(ctx) {
  const map = createMap(L);
  ctx.map = map;
  ctx.smoothZoom = installSmoothZoom(map, ctx.reduceMotion);
  ctx.CityTooltip = createCityTooltip(L);
  createPanes(map);
  ctx.layers.detail = createDetailLayer(L);
  ctx.labels = installBasemapLabels(map);
  ctx.photos = installAtlasPhotos(map, {
    onLayout: () => declutterLabels(ctx),
    focus: target => focusPhoto(ctx, target)
  });
  addAttributions(map);
  fitWorld(ctx, false);
}

/**
 * Installs route cards, settings and the itinerary panel.
 * @param {AtlasContext} ctx
 * @param {HTMLElement} main
 */
function installPanels(ctx, main) {
  ctx.cards = installRouteCards(L);
  ctx.settings = $('#map-settings');
  if (ctx.settings) {
    installSettings({
      dialog: ctx.settings,
      globeView: Boolean(globeRenderer),
      globeSupported,
      cards: ctx.cards,
      photos: ctx.photos,
      onUnitChange: () => ctx.itineraries.refresh()
    });
  }
  ctx.activityPopup = L.popup(CARD_OPTIONS);
  ctx.layers.badges = L.layerGroup();
  ctx.itineraries = installTripItineraries({
    cards: ctx.cards,
    modes: ROUTE_MODES,
    onFit: points => fitBesidePanel(ctx, points),
    onHighlight: refs => highlightRoutes(ctx, refs),
    onToggle: (open, pan) => panelToggled(ctx, open, pan),
    closePopup: () => ctx.map.closePopup(),
    geometry: ref => legPoints(ctx, ref),
    photos: () => ctx.state.allPhotos,
    showPhotos: ids => ctx.photos.show(ids)
  });
  ctx.hint = createRouteHint(main);
}

/**
 * Draws the loaded data, applies the URL and signals that the atlas is ready.
 * @param {AtlasContext} ctx
 * @param {import('./atlas/loader.js').AtlasData} data
 */
async function showData(ctx, data) {
  const { map, state } = ctx;
  await map.ready;
  state.journeys = data.activities.journeys || [];
  state.transport = data.connections.routes || [];
  state.flightLog = data.flights;
  map.configureFlights?.(state.flightLog);
  ctx.itineraries.load(data.itineraries, state.journeys, state.transport, state.flightLog);
  ctx.labels.cities(data.context.cities || []);
  renderStates(ctx, data.states);
  renderWorld(ctx, data.world);
  renderFlights(ctx);
  renderTransport(ctx);
  renderRoutes(ctx);
  renderCities(ctx);
  ctx.status.textContent = '';
  applyHash(ctx, false);
  ctx.photos.load(data.photos.photos || []);
  state.allPhotos = mappablePhotos(data.photos.photos);
  ctx.itineraries.refresh();
  updateBadges(ctx);
  if (data.photos.unavailable) ctx.status.textContent = 'Photos unavailable. Refresh to retry.';
  applyDeepLink(ctx);
  queueRouteAnimations(ctx);
  // Signals scripts and tests that the atlas has finished its first render.
  map.getContainer().dataset.ready = 'true';
  document.dispatchEvent(new CustomEvent('atlas:ready', { detail: { map } }));
}

/**
 * @param {{ main: HTMLElement, legend: HTMLElement, status: HTMLElement }} elements
 */
function startAtlas({ main, legend, status }) {
  const ctx = createContext(L, { legend, status });
  installMap(ctx);
  installPanels(ctx, main);
  installEscapeKeys(ctx);
  installPopupEvents(ctx);
  installViewEvents(ctx);
  loadAtlasData()
    .then(data => showData(ctx, data))
    .catch(error => {
      status.textContent = 'Map unavailable. Refresh to retry.';
      console.error(error);
    });
}

const elements = {
  map: $('#map'),
  main: $('#main'),
  legend: $('#route-legend'),
  status: $('#map-status')
};
if (Object.values(elements).every(Boolean)) startAtlas(elements);
