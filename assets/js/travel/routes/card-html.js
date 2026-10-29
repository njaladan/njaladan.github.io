import { escapeHtml } from '../../lib/html.js';
import { plural } from '../shared/format.js';
import { icon } from '../shared/route-icons.js';

// Popup markup for route cards. Every value from the card is escaped here;
// only `attrs` given as a string is taken as markup the caller already escaped.

const CARD_PHOTO_LIMIT = 4;
// Stop lists longer than this use the compact two-column layout.
const LONG_STOP_LIST = 7;
const ROW_CHEVRON =
  '<svg class="card-row-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>';

/**
 * @typedef {[string | number, string] | {distanceKm: number, precision: number} | {elevationM: number}} CardStat
 * @typedef {string | Record<string, string | number | boolean | null | undefined>} CardAttrs
 *   Extra attributes: a map of name → value (escaped; true adds a bare attribute),
 *   or a string of attribute markup the caller has already escaped.
 * @typedef {object} RouteCard
 * @property {string} modeKey
 * @property {string} modeName
 * @property {string} color
 * @property {string} [context]
 * @property {string} title
 * @property {string} [quote]
 * @property {string} [subtitle]
 * @property {string} [note]
 * @property {string[]} [stops]
 * @property {CardStat[]} stats
 * @property {string} [rowsLabel]
 * @property {{cells: string[], attrs?: CardAttrs}[]} [rows]
 * @property {{title: string, subtitle?: string, duration?: string}[]} [services]
 * @property {any[]} [photos]
 * @property {{index: number, total: number} | null} [stepper]
 * @property {{id: string, title: string, noun: string, index: number, steps: any[]} | null} [trip]
 * @property {CardAttrs} [attrs]
 *
 * @typedef {object} CardFormatters
 * @property {(distanceKm: number, precision: number) => [string, string]} formatDistance
 * @property {(meters: number) => [string, string]} formatElevation e.g. ['120', 'Climb m']
 * @property {(photo: any) => string} thumbnail URL of a photo's thumbnail
 */

/**
 * Serializes extra attributes for a card or row element.
 * @param {CardAttrs | undefined} attrs
 * @returns {string}
 */
export function attributesHtml(attrs) {
  if (!attrs) return '';
  if (typeof attrs === 'string') return attrs;
  return Object.entries(attrs)
    .filter(([, value]) => value != null && value !== false)
    .map(([name, value]) =>
      value === true ? escapeHtml(name) : `${escapeHtml(name)}="${escapeHtml(value)}"`
    )
    .join(' ');
}

/** @param {string} className @param {string | undefined} text */
const paragraph = (className, text) =>
  text ? `<p class="${className}">${escapeHtml(text)}</p>` : '';

/**
 * One stat cell; distances and elevations carry their raw value so a unit
 * change can rewrite them.
 * @param {CardStat} stat
 * @param {Pick<CardFormatters, 'formatDistance' | 'formatElevation'>} formatters
 */
export function statHtml(stat, { formatDistance, formatElevation }) {
  if (!Array.isArray(stat) && 'distanceKm' in stat && Number.isFinite(stat.distanceKm)) {
    const [value, label] = formatDistance(stat.distanceKm, stat.precision);
    return `<div data-distance-km="${escapeHtml(stat.distanceKm)}" data-distance-precision="${escapeHtml(stat.precision)}"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`;
  }
  if (!Array.isArray(stat) && 'elevationM' in stat && Number.isFinite(stat.elevationM)) {
    const [value, label] = formatElevation(stat.elevationM);
    return `<div data-elevation-m="${escapeHtml(stat.elevationM)}"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`;
  }
  const [value, label] = /** @type {[string, string]} */ (stat);
  return `<div><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`;
}

/** @param {RouteCard} card */
function headHtml(card) {
  const context = card.context
    ? `<span class="card-context">${escapeHtml(card.context)}</span>`
    : '';
  return `<div class="card-head"><span class="card-icon">${icon(card.modeKey)}</span><span>${escapeHtml(card.modeName)}</span>${context}</div>`;
}

/** @param {string[] | undefined} stops */
function stopsHtml(stops) {
  if (!(stops?.length > 2)) return '';
  const long = stops.length > LONG_STOP_LIST ? ' card-stops-long' : '';
  const items = stops
    .map(stop => `<li title="${escapeHtml(stop)}"><span>${escapeHtml(stop)}</span></li>`)
    .join('');
  return `<ol class="card-stops${long}">${items}</ol>`;
}

/** @param {RouteCard['services']} services */
function servicesHtml(services) {
  if (!services?.length) return '';
  const articles = services.map(service => {
    const duration = service.duration
      ? `<span class="card-service-duration">${escapeHtml(service.duration)}</span>`
      : '';
    return `<article class="card-service"><div class="card-service-heading"><h3>${escapeHtml(service.title)}</h3>${duration}</div>${paragraph('card-service-operator', service.subtitle)}</article>`;
  });
  return `<section class="card-services" aria-label="Bus journeys">${articles.join('')}</section>`;
}

/** Rows with attributes are buttons (e.g. an airport's connections). */
function rowHtml({ cells, attrs }) {
  const spans = cells.map(cell => `<span>${escapeHtml(cell)}</span>`).join('');
  return attrs
    ? `<li><button class="card-row" ${attributesHtml(attrs)}>${spans}${ROW_CHEVRON}</button></li>`
    : `<li><div class="card-row">${spans}</div></li>`;
}

/** @param {RouteCard} card */
function rowsHtml(card) {
  if (!card.rows?.length) return '';
  const label = card.rowsLabel
    ? `<p class="card-rows-label card-label">${escapeHtml(card.rowsLabel)}</p>`
    : '';
  return `${label}<ol class="card-rows">${card.rows.map(rowHtml).join('')}</ol>`;
}

/**
 * @param {any[] | undefined} photos
 * @param {CardFormatters['thumbnail']} thumbnail
 */
function photosHtml(photos, thumbnail) {
  if (!photos?.length) return '';
  const prints = photos
    .slice(0, CARD_PHOTO_LIMIT)
    .map(
      photo =>
        `<button class="card-print" data-photo="${escapeHtml(photo.id)}" aria-label="Open photo: ${escapeHtml(photo.gallery?.subject || photo.place)}"><img src="${escapeHtml(thumbnail(photo))}" alt=""></button>`
    )
    .join('');
  const more =
    photos.length > CARD_PHOTO_LIMIT
      ? `<span class="card-more">+${photos.length - CARD_PHOTO_LIMIT}</span>`
      : '';
  return `<div class="card-photos"><span class="card-label">Taken along the way</span>${prints}${more}</div>`;
}

/** @param {RouteCard['stepper']} stepper */
function stepperHtml(stepper) {
  if (!stepper) return '';
  const first = stepper.index === 0 ? 'disabled' : '';
  const last = stepper.index === stepper.total - 1 ? 'disabled' : '';
  return `<div class="card-nav"><button data-step="-1" ${first}>← Previous</button><button data-step="1" ${last}>Next →</button></div>`;
}

/** @param {RouteCard['trip']} trip */
function tripHtml(trip) {
  if (!trip) return '';
  return `<button type="button" class="card-itinerary" data-itinerary="${escapeHtml(trip.id)}" data-trip-step="${escapeHtml(trip.index)}" aria-haspopup="dialog" aria-controls="trip-itinerary"><span>View full itinerary</span><span>${escapeHtml(plural(trip.steps.length, trip.noun))} →</span></button>`;
}

/**
 * Popup markup for one route card.
 * @param {RouteCard} card
 * @param {CardFormatters} formatters
 * @returns {string}
 */
export function cardHtml(card, { formatDistance, formatElevation, thumbnail }) {
  const classes = ['route-card', card.modeKey === 'Bus' && 'bus-card', card.trip && 'trip-card']
    .filter(Boolean)
    .join(' ');
  const stats = card.stats.length
    ? `<div class="card-stats">${card.stats.map(stat => statHtml(stat, { formatDistance, formatElevation })).join('')}</div>`
    : '';
  const quote = card.quote ? `“${card.quote}”` : '';
  return `<div class="${escapeHtml(classes)}" style="--mode:${escapeHtml(card.color)}" ${attributesHtml(card.attrs)}>
      ${headHtml(card)}
      <h2 class="card-title">${escapeHtml(card.title)}</h2>
      ${paragraph('card-quote', quote)}
      ${paragraph('card-sub', card.subtitle)}
      ${paragraph('card-note', card.note)}
      ${stopsHtml(card.stops)}
      ${stats}
      ${servicesHtml(card.services)}${rowsHtml(card)}${photosHtml(card.photos, thumbnail)}
      ${stepperHtml(card.stepper)}
      ${tripHtml(card.trip)}
    </div>`;
}
