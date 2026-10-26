import { ROUTE_MODES } from './shared/data.js';
import { $ } from '../lib/dom.js';
import { installSmoothZoom } from './map/smooth-zoom.js';
import { installBasemapLabels } from './map/basemap-labels.js';
import { installRouteCards } from './routes/index.js';
import { installTripItineraries } from './itineraries/index.js';
import { installAtlasPhotos } from './photos/index.js';
import { globeRenderer, globeSupported } from './globe/index.js';
import { createContext } from './map/context.js';
import { CARD_OPTIONS } from './map/constants.js';
import {
  addAttributions,
  createDetailLayer,
  createMap,
  createPanes,
  fitWorld
} from './map/camera.js';
import { installSettings } from './map/settings.js';
import { focusPhoto, renderStates, renderWorld } from './map/countries.js';
import { createCityTooltip, declutterLabels, renderCities } from './map/labels.js';
import { fitBesidePanel, legPoints, panelToggled } from './map/panel.js';
import { highlightRoutes } from './map/route-style.js';
import { installPopupEvents } from './map/popups.js';
import {
  createRouteHint,
  queueRouteAnimations,
  renderRoutes,
  renderTransport,
  updateBadges
} from './map/routes.js';
import { renderFlights } from './map/flights.js';
import { mappablePhotos } from './map/format.js';
import { applyDeepLink, applyHash, installEscapeKeys } from './map/router.js';
import { installViewEvents } from './map/view-events.js';
import { loadAtlasData } from './map/loader.js';

// The travel atlas: wires the map, its layers and panels together. Each
// module under map/ takes the shared context created here.

/** @typedef {import('./map/context.js').AtlasContext} AtlasContext */

const L = globeRenderer || window.L;

/**
 * Creates the map with its panes, basemap labels and photo pins.
 * @param {AtlasContext} ctx
 */
function installMap(ctx) {
  const map = createMap(L);
  ctx.map = map;
  ctx.smoothZoom = installSmoothZoom(map);
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
 * @param {import('./map/loader.js').AtlasData} data
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
