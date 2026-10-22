import { $$ } from '../lib/dom.js';
import { escapeHtml } from '../lib/html.js';
import { travelAsset } from './runtime.js';
import { haversine, midpoint, pathKm, photosNear } from './ui/geo.js';
import { formatDistance } from './ui/format.js';
import { icon } from './ui/route-icons.js';
import { cardHtml } from './ui/route-card-html.js';

const BADGE_SIZE = 24;
const AIRPORT_MARKER_SIZE = 44;
// Lifts airport popups above the badge rather than its centre.
const AIRPORT_POPUP_OFFSET = -14;

/**
 * Route cards: one popup layout shared by activities, transport, flights and
 * airports, plus the route badges and geometry helpers the map uses for them.
 * @param {any} [L] Leaflet, or the globe renderer's Leaflet-compatible API
 */
export function installRouteCards(L = window.L) {
  /** @type {'km' | 'mi'} */
  let distanceUnit = 'km';
  /** @type {(distanceKm: number, precision?: number) => [string, string]} */
  const format = (distanceKm, precision) => formatDistance(distanceKm, precision, distanceUnit);
  /** A distance stat, formatted in the current unit when rendered. */
  const distance = (distanceKm, precision = 0) => ({ distanceKm, precision });

  /** Switches units and rewrites the distance stats of any open card. */
  function setDistanceUnit(unit) {
    distanceUnit = unit === 'mi' ? 'mi' : 'km';
    $$('.card-stats [data-distance-km]').forEach(node => {
      const [value, label] = format(
        Number(node.dataset.distanceKm),
        Number(node.dataset.distancePrecision)
      );
      node.querySelector('b').textContent = value;
      node.querySelector('small').textContent = label;
    });
  }

  /** @param {import('./ui/route-card-html.js').RouteCard} card */
  const html = card =>
    cardHtml(card, {
      formatDistance: format,
      thumbnail: photo => travelAsset(photo.variants.thumbnail.src)
    });

  function badge(key, color) {
    return L.divIcon({
      className: 'route-badge',
      html: `<span style="--mode:${escapeHtml(color)}">${icon(key)}</span>`,
      iconSize: [BADGE_SIZE, BADGE_SIZE],
      iconAnchor: [BADGE_SIZE / 2, BADGE_SIZE / 2]
    });
  }
  function airportBadge(code, color) {
    return L.divIcon({
      className: 'airport-marker',
      html: `<span class="airport-badge" style="--mode:${escapeHtml(color)}">${icon('Flight')}</span><span class="airport-code" aria-hidden="true">${escapeHtml(code)}</span>`,
      iconSize: [AIRPORT_MARKER_SIZE, AIRPORT_MARKER_SIZE],
      iconAnchor: [AIRPORT_MARKER_SIZE / 2, AIRPORT_MARKER_SIZE / 2],
      popupAnchor: [0, AIRPORT_POPUP_OFFSET]
    });
  }

  return {
    html,
    icon,
    badge,
    airportBadge,
    midpoint,
    km: pathKm,
    haversine,
    photosNear,
    distance,
    formatDistance: format,
    setDistanceUnit
  };
}
