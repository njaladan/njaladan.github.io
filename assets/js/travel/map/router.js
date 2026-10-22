import { HOME_COUNTRY } from '../shared/data.js';
import { DEEP_LINK_ZOOM, MAX_ZOOM, MIN_ZOOM } from './constants.js';
import { popupOpen } from './camera.js';
import { focusCountry, showWorld } from './countries.js';
import { parseAtlasHash } from './format.js';
import { parseViewParams } from './geometry.js';

// URL state: #country=…&state=… selects a place; ?lat=&lng=&zoom= opens a view.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

/**
 * Shows the place the hash names, or the world. Unknown countries are cleared
 * from the URL.
 * @param {AtlasContext} ctx
 * @param {boolean} [animate]
 */
export function applyHash(ctx, animate = true) {
  const { country, state, invalid } = parseAtlasHash(location.hash);
  ctx.state.currentState = state;
  if (country) {
    focusCountry(ctx, country, animate);
    return;
  }
  if (invalid) history.replaceState(null, '', location.pathname + location.search);
  showWorld(ctx, animate);
}

/**
 * Opens the view a `?lat=&lng=&zoom=` link names, such as a photo's location.
 * @param {AtlasContext} ctx
 */
export function applyDeepLink(ctx) {
  const view = parseViewParams(location.search, {
    zoom: DEEP_LINK_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM
  });
  if (view) ctx.map.setView([view.lat, view.lng], view.zoom, { animate: false });
}

/**
 * Escape closes the innermost layer first: dialogs, photos and cards handle
 * their own; then the itinerary panel; then a selected state or country.
 * @param {AtlasContext} ctx
 */
export function installEscapeKeys(ctx) {
  const { itineraries, photos, settings } = ctx;
  const othersClosed = () => !settings?.open && !photos.isOpen() && !popupOpen(ctx);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && itineraries.isOpen() && othersClosed()) {
      event.stopImmediatePropagation();
      itineraries.close();
    }
  });
  document.addEventListener('keydown', event => {
    if (
      event.key === 'Escape' &&
      !itineraries.isOpen() &&
      othersClosed() &&
      ctx.state.currentCountry
    ) {
      location.hash = ctx.state.currentState ? `country=${HOME_COUNTRY}` : '';
    }
  });
}
