import { AIRPORT_ZOOM, MAX_ZOOM, MIN_ZOOM, WORLD_BOUNDS, WORLD_PADDING } from './constants.js';
import { ramp } from './geometry.js';

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

const FLY_SECONDS = 1.25;
const FIT_PADDING = { paddingTopLeft: [35, 90], paddingBottomRight: [80, 40] };
const TILE_ROOT = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
// Panes in stacking order; equal z-indexes stack in creation order.
const PANES = [
  ['states', 360],
  ['routes', 420],
  ['flights', 420],
  ['airports', 430],
  ['cities', 450],
  ['countries', 350],
  ['visitShading', 355, 'none'],
  ['detail', 370, 'none']
];
// Zoom fades as [start, span]: a layer goes from hidden to shown across span.
const DETAIL_FADE = [5, 2];
const VISIT_SHADING_FADE = [0, 1.5];
const VISIT_SHADING_ZOOM = 5;
const STATE_FADE = [3.3, 1.2];
const CITY_FADE = [3.4, 1.2];
const ROUTE_FADE = [3, 1.5];
const CLOSE_VIEW_FADE = [7, 4];
// Flights recede to this share of their opacity in close views.
const FLIGHT_CLOSE_FADE = 0.88;
// Faded panes stop taking clicks below this opacity.
const INTERACTIVE_OPACITY = 0.1;

/**
 * Creates the Leaflet (or globe) map in #map.
 * @param {any} L
 */
export function createMap(L) {
  const map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: false,
    dragging: true,
    touchZoom: true,
    zoomSnap: 0,
    zoomDelta: 0.5,
    zoomAnimation: false,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    worldCopyJump: true
  });
  map.atlasRenderer = L;
  return map;
}

/** @param {any} map */
export function createPanes(map) {
  PANES.forEach(([name, zIndex, pointerEvents]) => {
    map.createPane(name);
    const pane = map.getPane(name);
    pane.style.zIndex = String(zIndex);
    if (pointerEvents) pane.style.pointerEvents = pointerEvents;
  });
}

/**
 * Esri's light basemap, faded in at city zoom.
 * @param {any} L
 */
export function createDetailLayer(L) {
  const options = {
    pane: 'detail',
    minZoom: 5,
    maxNativeZoom: 16,
    maxZoom: MAX_ZOOM,
    noWrap: true
  };
  return L.layerGroup([
    L.tileLayer(`${TILE_ROOT}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      ...options,
      attribution: 'Tiles © Esri · HERE · Garmin · OpenStreetMap contributors'
    }),
    L.tileLayer(`${TILE_ROOT}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, options)
  ]);
}

/** @param {any} map */
export function addAttributions(map) {
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    'Routes © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  );
  map.attributionControl.addAttribution(
    '<a href="https://www.naturalearthdata.com/">Natural Earth</a>'
  );
  map.attributionControl.addAttribution(
    'Airports: <a href="https://ourairports.com/data/">OurAirports</a>'
  );
}

/**
 * With zoomSnap 0, Leaflet's stop() fires viewreset and re-projects every
 * route, a long pause before the next animation. Only stop one that runs.
 * @param {AtlasContext} ctx
 */
export function stopCamera(ctx) {
  ctx.smoothZoom.finish();
  if (ctx.state.cameraMoving) ctx.map.stop();
}

/**
 * @param {AtlasContext} ctx
 * @param {any} bounds
 * @param {number} [maxZoom]
 * @param {boolean} [animate]
 */
export function fitView(ctx, bounds, maxZoom = 10, animate = true) {
  stopCamera(ctx);
  const options = { maxZoom, ...FIT_PADDING };
  if (ctx.reduceMotion || !animate) ctx.map.fitBounds(bounds, { ...options, animate: false });
  else ctx.map.flyToBounds(bounds, { ...options, duration: FLY_SECONDS });
}

/**
 * @param {AtlasContext} ctx
 * @param {boolean} animate
 */
export function fitWorld(ctx, animate) {
  const bounds = ctx.L.latLngBounds(WORLD_BOUNDS);
  if (!animate) ctx.map.fitBounds(bounds, { padding: WORLD_PADDING, animate: false });
  else ctx.map.flyToBounds(bounds, { padding: WORLD_PADDING, duration: FLY_SECONDS });
}

/**
 * Leaflet maps have no isPopupOpen(); any open popup is in the DOM.
 * @param {AtlasContext} ctx
 */
export const popupOpen = ctx => Boolean(ctx.map.getContainer().querySelector('.leaflet-popup'));

/**
 * @param {number} zoom
 * @param {number[]} fade [start, span]
 */
const zoomFade = (zoom, [start, span]) => ramp(zoom, start, span);

/**
 * @param {HTMLElement} pane
 * @param {number} opacity
 */
function fadePane(pane, opacity) {
  pane.style.opacity = String(opacity);
  pane.style.pointerEvents = opacity > INTERACTIVE_OPACITY ? 'auto' : 'none';
}

/**
 * Cross-fades the world shading, detail tiles and route panes for the zoom.
 * @param {AtlasContext} ctx
 */
export function updateBasemap(ctx) {
  const { map, layers } = ctx,
    zoom = map.getZoom();
  map.getPane('visitShading').style.opacity = String(
    zoomFade(VISIT_SHADING_ZOOM - zoom, VISIT_SHADING_FADE)
  );
  const detailOpacity = zoomFade(zoom, DETAIL_FADE);
  map.getPane('detail').style.opacity = String(detailOpacity);
  if (detailOpacity > 0 && !map.hasLayer(layers.detail)) layers.detail.addTo(map);
  if (detailOpacity === 0 && map.hasLayer(layers.detail)) map.removeLayer(layers.detail);
  map.getPane('backgroundLabels').style.opacity = String(1 - detailOpacity);
  map.getPane('countries').style.pointerEvents = 'auto';
  fadePane(map.getPane('states'), zoomFade(zoom, STATE_FADE));
  map.getPane('cities').style.opacity = '1';
  fadePane(map.getPane('routes'), zoomFade(zoom, ROUTE_FADE));
  map.getPane('airports').hidden = zoom < AIRPORT_ZOOM;
  ctx.legend.hidden = !ctx.legend.textContent;
  const container = map.getContainer();
  container.style.setProperty('--city-opacity', String(zoomFade(zoom, CITY_FADE)));
  const closeView = zoomFade(zoom, CLOSE_VIEW_FADE);
  container.style.setProperty('--flight-context', String(1 - closeView * FLIGHT_CLOSE_FADE));
}
