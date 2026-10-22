import { escapeHtml } from '../../lib/html.js';
import { formatDay, formatDuration, plural } from '../shared/format.js';
import { onFootKm, tripModes } from './model.js';
import { icon } from '../shared/route-icons.js';

// Markup for the itinerary panel's trip list and day-by-day trip view. Every
// interpolated value is escaped, including data attributes and --mode colors.

const DAY_PHOTO_LIMIT = 6;

/**
 * @typedef {import('./model.js').Trip} Trip
 * @typedef {import('./model.js').Day} Day
 * @typedef {import('./model.js').Leg} Leg
 * @typedef {object} ItineraryFormatters
 * @property {(key: string) => {name: string, color: string}} mode
 * @property {(km: number) => string} distance e.g. '4.2 km'
 * @property {(photo: any) => string} thumbnail URL of a photo's thumbnail
 */

/** @param {string} color */
const modeStyle = color => `style="--mode:${escapeHtml(color)}"`;

/**
 * The secondary facts of a leg, each already escaped.
 * @param {Leg} leg
 * @param {ItineraryFormatters} format
 * @returns {string[]}
 */
export function legStats(leg, format) {
  return [
    leg.detail || '',
    Number.isFinite(leg.distanceKm) ? format.distance(leg.distanceKm) : '',
    Number.isFinite(leg.elapsed) ? `${formatDuration(leg.elapsed)} h` : '',
    Number.isFinite(leg.elevation) && leg.elevation > 0
      ? `↑ ${Math.round(leg.elevation).toLocaleString()} m`
      : ''
  ]
    .filter(Boolean)
    .map(escapeHtml);
}

/**
 * @param {Leg} leg
 * @param {ItineraryFormatters} format
 */
export function legHtml(leg, format) {
  const mode = format.mode(leg.mode);
  const stats = legStats(leg, format)
    .map(stat => `<span>${stat}</span>`)
    .join('');
  return `<li class="itinerary-leg" data-leg-kind="${escapeHtml(leg.kind)}" data-leg-id="${escapeHtml(leg.id)}" ${modeStyle(mode.color)} tabindex="0">
      <span class="itinerary-leg-icon" aria-hidden="true">${icon(leg.mode)}</span>
      <span class="itinerary-leg-text"><b>${escapeHtml(leg.title)}</b><small><span class="visually-hidden">${escapeHtml(mode.name)} · </span>${stats}</small></span>
    </li>`;
}

/**
 * @param {string} key
 * @param {ItineraryFormatters} format
 */
function modeTag(key, format) {
  const mode = format.mode(key);
  return `<span class="itinerary-mode" ${modeStyle(mode.color)}>${icon(key)}${escapeHtml(mode.name)}</span>`;
}

/**
 * One trip in the list, with its first photo or else its first mode's glyph.
 * @param {Trip} trip
 * @param {any | undefined} cover
 * @param {ItineraryFormatters} format
 */
function tripItemHtml(trip, cover, format) {
  const modesUsed = tripModes(trip);
  const first = format.mode(modesUsed[0]);
  const art = cover
    ? `<img src="${escapeHtml(format.thumbnail(cover))}" alt="">`
    : `<span class="itinerary-trip-icon" ${modeStyle(first.color)} aria-hidden="true">${icon(modesUsed[0])}</span>`;
  const glyphs = modesUsed
    .map(key => {
      const mode = format.mode(key);
      return `<span ${modeStyle(mode.color)} title="${escapeHtml(mode.name)}">${icon(key)}</span>`;
    })
    .join('');
  return `<li><button type="button" class="itinerary-trip" data-open-trip="${escapeHtml(trip.id)}">
          ${art}
          <span class="itinerary-trip-text"><b>${escapeHtml(trip.title)}</b>
          <span class="itinerary-trip-meta">${escapeHtml(plural(trip.days.length, 'day'))} · ${glyphs}</span></span>
          <span class="itinerary-trip-arrow" aria-hidden="true">→</span>
        </button></li>`;
}

/**
 * The panel's trip list.
 * @param {Trip[]} trips
 * @param {(trip: Trip) => any | undefined} cover first photo of a trip
 * @param {ItineraryFormatters} format
 */
export function tripListHtml(trips, cover, format) {
  return `<p class="itinerary-subtitle">Choose a trip to follow it day by day.</p>
      <ul class="itinerary-trips">${trips.map(trip => tripItemHtml(trip, cover(trip), format)).join('')}</ul>`;
}

/**
 * Up to DAY_PHOTO_LIMIT photo buttons for a day, then a count of the rest.
 * @param {any[]} photos
 * @param {number} dayIndex
 * @param {ItineraryFormatters} format
 */
function dayPhotosHtml(photos, dayIndex, format) {
  if (!photos.length) return '';
  const buttons = photos
    .slice(0, DAY_PHOTO_LIMIT)
    .map(
      (photo, index) =>
        `<button type="button" data-day-photo="${escapeHtml(dayIndex)}" data-photo-index="${escapeHtml(index)}" aria-label="Open photo: ${escapeHtml(photo.gallery?.subject || photo.place || 'Photo')}"><img src="${escapeHtml(format.thumbnail(photo))}" alt=""></button>`
    )
    .join('');
  const more =
    photos.length > DAY_PHOTO_LIMIT ? `<span>+${photos.length - DAY_PHOTO_LIMIT}</span>` : '';
  return `<div class="itinerary-photos">${buttons}${more}</div>`;
}

/**
 * @param {Day} day
 * @param {number} i
 * @param {{current: boolean, photos: any[]}} state
 * @param {ItineraryFormatters} format
 */
function dayHtml(day, i, { current, photos }, format) {
  const onFoot = onFootKm(day);
  const date = day.date ? ` · ${escapeHtml(formatDay(day.date))}` : '';
  const total = onFoot
    ? `<small class="itinerary-day-total">${escapeHtml(format.distance(onFoot))} on foot</small>`
    : '';
  const legs = day.legs.length
    ? `<ol class="itinerary-legs">${day.legs.map(leg => legHtml(leg, format)).join('')}</ol>`
    : '';
  return `<li class="itinerary-day${current ? ' current' : ''}" data-day="${escapeHtml(i)}">
          <span class="itinerary-dot" aria-hidden="true">${escapeHtml(i + 1)}</span>
          <button type="button" class="itinerary-day-head" data-select-day="${escapeHtml(i)}"${current ? ' aria-current="step"' : ''} aria-label="${escapeHtml(`${day.label}: ${day.title}. Show on map`)}">
            <small>${escapeHtml(day.label)}${date}</small>
            <b>${escapeHtml(day.title)}</b>
            ${total}
          </button>
          ${legs}
          ${dayPhotosHtml(photos, i, format)}
        </li>`;
}

/**
 * One trip, day by day, with the current day marked.
 * @param {Trip} trip
 * @param {any[][]} photosByDay
 * @param {ItineraryFormatters} format
 */
export function tripHtml(trip, photosByDay, format) {
  const modes = tripModes(trip);
  const modeTags = modes.length
    ? `<div class="itinerary-modes" aria-label="Travel modes">${modes.map(key => modeTag(key, format)).join('')}</div>`
    : '';
  const days = trip.days
    .map((day, i) => dayHtml(day, i, { current: i === trip.index, photos: photosByDay[i] }, format))
    .join('');
  const note = trip.note ? `<p class="itinerary-note">${escapeHtml(trip.note)}</p>` : '';
  return `${modeTags}
      <ol class="itinerary-days" aria-label="Days">${days}</ol>
      ${note}
      <p class="itinerary-help">Hover a day or leg to find it on the map. Select a day to zoom to it.</p>`;
}
