// Photos page: a gallery of geotagged travel photos, each linking to its spot on the map,
// searchable by place.
import { $, $$ } from './lib/dom.js';
import { stampedUrl } from './lib/assets.js';
import {
  fold,
  installBackToTop,
  installIndexBar,
  installSearchKey,
  readQuery,
  writeQuery
} from './lib/collection.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_ZOOM = 15;

/**
 * @typedef {object} Photo
 * @property {string} id
 * @property {[number, number]} coords Latitude, longitude.
 * @property {string} place
 * @property {string} [date]
 * @property {string} [caption]
 * @property {{ small?: { src: string }, medium?: { src: string } }} variants
 * @property {{ subject?: string, location?: string }} [gallery]
 */

/**
 * @param {any} photo
 * @returns {photo is Photo}
 */
const valid = photo =>
  photo &&
  Array.isArray(photo.coords) &&
  photo.coords.length === 2 &&
  photo.coords.every(Number.isFinite) &&
  Math.abs(photo.coords[0]) <= 90 &&
  Math.abs(photo.coords[1]) <= 180 &&
  photo.variants &&
  typeof photo.place === 'string';

/**
 * Stamped URL for a travel image path, or '' for anything that isn't one.
 * @param {string} base
 * @param {unknown} src
 */
const asset = (base, src) =>
  typeof src === 'string' && /^images\/travel\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg|png)$/.test(src)
    ? stampedUrl(src, base)
    : '';

/**
 * Curated order first, then newest, then by id.
 * @param {Photo[]} photos
 * @param {string[]} galleryOrder
 */
function ordered(photos, galleryOrder) {
  const order = new Map(galleryOrder.map((id, index) => [id, index]));
  return photos
    .filter(valid)
    .sort(
      (a, b) =>
        (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) ||
        (b.date || '').localeCompare(a.date || '') ||
        a.id.localeCompare(b.id)
    );
}

/** @param {HTMLElement} gallery @param {string} text */
function showMessage(gallery, text) {
  const message = document.createElement('p');
  message.className = 'gallery-empty';
  message.textContent = text;
  gallery.replaceChildren(message);
}

/** A small up-right arrow marking the card as a link to the map. */
function mapArrow() {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.classList.add('photo-map-arrow');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 12 12');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M3 9 9 3M3 3h6v6');
  icon.append(path);
  return icon;
}

/**
 * @param {string} className
 * @param {string} text
 */
function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * @param {Photo} photo
 * @param {string} subject
 * @param {string} location
 */
function caption(photo, subject, location) {
  const figcaption = document.createElement('figcaption');
  const heading = document.createElement('strong');
  heading.className = 'photo-subject';
  heading.textContent = subject;
  figcaption.append(heading);
  if (location) figcaption.append(span('photo-location', location));
  if (photo.caption) figcaption.append(span('photo-note', photo.caption));
  heading.append(mapArrow());
  return figcaption;
}

/**
 * A gallery card linking to the photo's spot on the map.
 * @param {Photo} photo
 * @param {string} imagePath
 * @param {string} mapUrl
 */
function photoCard(photo, imagePath, mapUrl) {
  const subject = photo.gallery?.subject || photo.place;
  const location = photo.gallery?.location || '';
  const label = location ? `${subject} — ${location}` : subject;
  const link = document.createElement('a');
  link.className = 'photo-card';
  link.href = `${mapUrl}?lat=${encodeURIComponent(photo.coords[0])}&lng=${encodeURIComponent(photo.coords[1])}&zoom=${MAP_ZOOM}`;
  link.setAttribute('aria-label', `View ${label} on the map`);
  link.dataset.search = fold([label, photo.place, photo.caption || ''].join(' '));
  const figure = document.createElement('figure');
  figure.style.margin = '0';
  const image = document.createElement('img');
  image.src = imagePath;
  image.alt = photo.caption || label;
  image.loading = 'lazy';
  image.decoding = 'async';
  figure.append(image, caption(photo, subject, location));
  link.append(figure);
  return link;
}

/**
 * Shows the cards matching the search box, and keeps the count and address in step.
 * @param {HTMLElement} gallery
 * @param {HTMLInputElement} search
 */
function installSearch(gallery, search) {
  const bar = $('[data-index-bar]');
  const count = $('[data-count]');
  const empty = $('[data-empty]');
  const cards = $$('.photo-card', gallery);
  const filter = () => {
    const query = fold(search.value.trim());
    let shown = 0;
    for (const card of cards) {
      card.hidden = !card.dataset.search.includes(query);
      if (!card.hidden) shown += 1;
    }
    if (count) count.textContent = `${shown} ${shown === 1 ? 'photo' : 'photos'}`;
    if (empty) empty.hidden = Boolean(shown);
    writeQuery({ q: search.value.trim() }, { q: '' });
  };
  search.value = readQuery(location.search, { q: '' }).q;
  search.addEventListener('input', filter);
  installSearchKey(search);
  if (bar) {
    bar.hidden = false;
    installIndexBar(bar);
  }
  filter();
}

async function init() {
  const gallery = $('#photo-gallery');
  if (!gallery) return;
  const base = gallery.dataset.assetBase;
  const mapUrl = gallery.dataset.mapUrl;
  try {
    const response = await fetch(stampedUrl('data/travel/photos.json', base));
    if (!response.ok) throw new Error('Photo list unavailable');
    const { photos = [], gallery_order = [] } = await response.json();
    const entries = ordered(photos, gallery_order);
    if (!entries.length) {
      showMessage(gallery, 'No geotagged photos are available yet.');
      return;
    }
    for (const photo of entries) {
      const imagePath = asset(base, photo.variants.small?.src || photo.variants.medium?.src);
      if (imagePath) gallery.append(photoCard(photo, imagePath, mapUrl));
    }
    const search = /** @type {HTMLInputElement | null} */ ($('[data-search]'));
    if (search) installSearch(gallery, search);
    installBackToTop();
  } catch (error) {
    console.error(error);
    showMessage(gallery, 'Photos could not be loaded. Refresh to try again.');
  }
}

init();
