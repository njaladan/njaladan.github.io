import { $ } from '../../lib/dom.js';
import { PHONE_QUERY } from './constants.js';
import { dayPoints } from './activities.js';
import { stopCamera } from './camera.js';
import { highlightRoutes } from './route-style.js';

// The itinerary panel covers the map's right side (bottom on phones). The map
// fits trips in the rest, and slides aside for the panel and back when it closes.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */
/** @typedef {{ kind: string, id: string }} LegRef */

const PANEL_SELECTOR = '#trip-itinerary';
const TRIP_MAX_ZOOM = 13;
const TRIP_FLY_SECONDS = 1.1;
// Fallback for the panel's CSS transition (seconds).
const PANEL_SLIDE_SECONDS = 0.34;
// easeLinearity 1/3 is Leaflet's cubic ease-out, the curve of the panel's transition.
const PANEL_EASE = 1 / 3;
// Cards keep this much more room from the panel than Leaflet's padding.
const CARD_PANEL_GAP = 4;
const CARD_PADDING_BOTTOM_RIGHT = [20, 20];

/**
 * The geometry of an itinerary leg: an activity, transport leg or flight.
 * @param {AtlasContext} ctx
 * @param {LegRef} ref
 * @returns {number[][]}
 */
export function legPoints(ctx, ref) {
  const { flightLog, journeys, transport } = ctx.state;
  if (ref.kind === 'flight') {
    return (
      flightLog.routes
        .find(connection => connection.airports.join('-') === ref.id)
        ?.segments.flat() || []
    );
  }
  if (ref.kind === 'activity') {
    const journey = journeys.find(item => item.days?.some(day => day.id === ref.id));
    const day = journey?.days.find(item => item.id === ref.id);
    if (day) return dayPoints(ctx, day);
  }
  const connection = ref.kind === 'transport' ? transport.find(item => item.id === ref.id) : null;
  return connection?.coords || [];
}

/** @returns {HTMLElement} */
const panelElement = () => $(PANEL_SELECTOR);
const isPhone = () => matchMedia(PHONE_QUERY).matches;

/** Fit padding that keeps routes out from under the panel. */
function panelPadding() {
  const panel = panelElement();
  return isPhone()
    ? { paddingTopLeft: [20, 64], paddingBottomRight: [20, panel.offsetHeight + 16] }
    : { paddingTopLeft: [35, 90], paddingBottomRight: [panel.offsetWidth + 56, 40] };
}

/**
 * @param {AtlasContext} ctx
 * @param {number[][]} points
 */
export function fitBesidePanel(ctx, points) {
  if (!points?.length) return;
  stopCamera(ctx);
  ctx.photos.cancel();
  const bounds = ctx.L.latLngBounds(points),
    options = { maxZoom: TRIP_MAX_ZOOM, ...panelPadding() };
  ctx.map.flyToBounds(bounds, { ...options, duration: TRIP_FLY_SECONDS });
}

/**
 * Pans with the panel's own slide. The transition starts at the next frame's
 * style pass, so the pan does too.
 * @param {AtlasContext} ctx
 * @param {number[]} shift
 * @param {HTMLElement} panel
 */
function slideMap(ctx, shift, panel) {
  stopCamera(ctx);
  const options = {
    animate: true,
    duration: parseFloat(getComputedStyle(panel).transitionDuration) || PANEL_SLIDE_SECONDS,
    easeLinearity: PANEL_EASE
  };
  requestAnimationFrame(() => ctx.map.panBy(shift, options));
}

/**
 * Slides the map aside when the panel opens and back when it closes. A trip
 * view already fits beside the panel, so it only needs the slide back.
 * @param {AtlasContext} ctx
 * @param {boolean} open
 * @param {boolean} pan Whether opening should slide the map.
 */
export function panelToggled(ctx, open, pan) {
  const { state } = ctx,
    padding = panelPadding(),
    panel = panelElement();
  ctx.activityPopup.options.autoPanPaddingBottomRight = open
    ? padding.paddingBottomRight.map(value => value + CARD_PANEL_GAP)
    : CARD_PADDING_BOTTOM_RIGHT;
  if (open) {
    state.panelShift = isPhone()
      ? [0, Math.round(panel.offsetHeight / 2)]
      : [Math.round(panel.offsetWidth / 2), 0];
    if (pan) slideMap(ctx, state.panelShift, panel);
    return;
  }
  highlightRoutes(ctx, null);
  if (state.panelShift) {
    slideMap(
      ctx,
      state.panelShift.map(value => -value),
      panel
    );
  }
  state.panelShift = null;
}
