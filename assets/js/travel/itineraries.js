import { $ } from '../lib/dom.js';
import { travelAsset } from './runtime.js';
import {
  assignDayPhotos,
  buildTrips,
  dayPoints,
  rotate,
  tripPoints
} from './ui/itinerary-model.js';
import { tripHtml, tripListHtml } from './ui/itinerary-html.js';
import { createSlidingPanel } from './ui/sliding-panel.js';

// Saved trips are ordered days of legs that link to the original activity and
// transport records. A side panel lists the trips and shows one trip's days
// beside the map; route cards link to it. No completion is stored.

const FALLBACK_MODE_COLOR = '#697c84';
// Space kept above the current day when scrolling it into view.
const DAY_SCROLL_MARGIN = 8;
const NO_SCROLL = { preventScroll: true };

/**
 * @typedef {import('./ui/itinerary-model.js').Trip} Trip
 * @typedef {import('./ui/itinerary-model.js').TripRef} TripRef
 * @typedef {object} ItineraryOptions
 * @property {{formatDistance: (km: number, precision?: number) => [string, string]}} cards
 * @property {Record<string, {name: string, color: string}>} modes
 * @property {(points: number[][]) => void} onFit
 * @property {(refs: {kind: string, id: string}[] | null) => void} onHighlight
 * @property {(open: boolean, resize?: boolean) => void} onToggle
 * @property {() => void} closePopup
 * @property {import('./ui/itinerary-model.js').LegGeometry} geometry
 * @property {() => any[]} photos the current photo list
 * @property {(ids: string[]) => void} showPhotos
 */

// Returned when the page has no itinerary panel, so callers need no checks.
const INERT_ITINERARIES = {
  load() {},
  card: () => null,
  open() {},
  openList() {},
  close() {},
  sync() {},
  isOpen: () => false,
  forActivity: () => undefined,
  forTransport: () => undefined,
  refresh() {}
};

function findElements() {
  const panel = /** @type {HTMLDialogElement | null} */ ($('#trip-itinerary'));
  const launcher = $('#trip-itineraries-button');
  if (!panel || !launcher) return null;
  return {
    panel,
    launcher,
    content: $('.trip-itinerary-content', panel),
    heading: $('#trip-itinerary-title', panel),
    back: $('.trip-itinerary-back', panel),
    closeButton: $('.trip-itinerary-close', panel)
  };
}

/** Photos per day for each trip, recomputed when the photo list changes. */
function createDayPhotoCache(photos, geometry) {
  let cache = { source: null, days: new Map() };
  return {
    reset() {
      cache = { source: null, days: new Map() };
    },
    /** @param {Trip} trip @returns {any[][]} */
    get(trip) {
      const source = photos();
      if (cache.source !== source) cache = { source, days: new Map() };
      if (!cache.days.has(trip.id)) {
        cache.days.set(trip.id, assignDayPhotos(trip, source, geometry));
      }
      return cache.days.get(trip.id);
    }
  };
}

/**
 * Marks the hovered or focused day or leg and highlights its routes on the map.
 * @param {HTMLElement} content
 * @param {(refs: {kind: string, id: string}[] | null) => void} onHighlight
 * @param {() => Trip | undefined} currentTrip
 * @returns {(target: EventTarget | null) => void}
 */
function createHighlighter(content, onHighlight, currentTrip) {
  let highlighted = '';
  return target => {
    const element = /** @type {Element | null} */ (target);
    const leg = /** @type {HTMLElement | null} */ (element?.closest('[data-leg-id]'));
    const day = /** @type {HTMLElement | null} */ (element?.closest('[data-day]'));
    const trip = currentTrip();
    let refs = null,
      key = '';
    if (leg) {
      refs = [{ kind: leg.dataset.legKind, id: leg.dataset.legId }];
      key = `leg:${leg.dataset.legId}`;
    } else if (day && trip) {
      refs = trip.days[Number(day.dataset.day)].legs.map(({ kind, id }) => ({ kind, id }));
      key = `day:${day.dataset.day}`;
    }
    if (key === highlighted) return;
    highlighted = key;
    content
      .querySelectorAll('.is-highlighted')
      .forEach(node => node.classList.remove('is-highlighted'));
    (leg || day)?.classList.add('is-highlighted');
    onHighlight(refs?.length ? refs : null);
  };
}

/** @param {ItineraryOptions} options */
function formatters({ cards, modes }) {
  const mode = key => modes[key] || { name: key, color: FALLBACK_MODE_COLOR };
  return {
    mode,
    distance: km => {
      const [value, unit] = cards.formatDistance(km, 1);
      return `${value} ${unit.toLowerCase()}`;
    },
    thumbnail: photo => travelAsset(photo.variants.thumbnail.src)
  };
}

/**
 * Shared state of one itinerary panel.
 * @typedef {ReturnType<typeof createContext>} Context
 */
function createContext(elements, options) {
  const state = {
    /** @type {Map<string, Trip>} */
    trips: new Map(),
    /** @type {Map<string, TripRef>} */
    activityRefs: new Map(),
    /** @type {Map<string, TripRef>} */
    transportRefs: new Map(),
    /** @type {string | null} */
    currentId: null,
    /** @type {'list' | 'trip'} */
    view: 'list',
    /** @type {HTMLElement | null} */
    opener: null
  };
  const currentTrip = () => state.trips.get(state.currentId);
  return {
    ...elements,
    options,
    state,
    currentTrip,
    format: formatters(options),
    dayPhotos: createDayPhotoCache(options.photos, options.geometry),
    highlight: createHighlighter(elements.content, options.onHighlight, currentTrip),
    slide: createSlidingPanel(elements.panel, {
      reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      onToggle: options.onToggle
    })
  };
}

/** @param {Context} ctx */
function render(ctx) {
  ctx.highlight(null);
  const trip = ctx.state.view === 'trip' ? ctx.currentTrip() : undefined;
  if (trip) {
    ctx.heading.textContent = trip.title;
    ctx.back.hidden = false;
    ctx.content.innerHTML = tripHtml(trip, ctx.dayPhotos.get(trip), ctx.format);
    return;
  }
  ctx.heading.textContent = 'Itineraries';
  ctx.back.hidden = true;
  ctx.content.innerHTML = tripListHtml(
    [...ctx.state.trips.values()],
    item => ctx.dayPhotos.get(item).flat()[0],
    ctx.format
  );
}

/** @param {Context} ctx */
function focusFirstTrip(ctx) {
  $('[data-open-trip]', ctx.content)?.focus(NO_SCROLL);
}

/** @param {Context} ctx */
function closePanel(ctx) {
  if (!ctx.panel.open) return;
  ctx.highlight(null);
  ctx.slide.hide();
  const target = ctx.state.opener?.isConnected ? ctx.state.opener : ctx.launcher;
  target.focus(NO_SCROLL);
}

/**
 * Replaces the trips from saved definitions and the records they link to.
 * @param {Context} ctx
 * @param {{definitions: any, journeys: any[], transport: any[], flightLog?: any}} records
 */
function loadTrips(ctx, { definitions, journeys, transport, flightLog }) {
  const built = buildTrips(definitions, { journeys, transport, flightLog });
  Object.assign(ctx.state, built);
  ctx.dayPhotos.reset();
  const { trips } = ctx.state;
  if (!trips.has(ctx.state.currentId)) ctx.state.currentId = trips.keys().next().value || null;
  ctx.launcher.hidden = !trips.size;
  if (!ctx.panel.open) return;
  if (trips.size) render(ctx);
  else closePanel(ctx);
}

/**
 * The toolbar button lists the trips; picking one flies to the whole trip.
 * @param {Context} ctx
 * @param {HTMLElement} trigger
 */
function openList(ctx, trigger) {
  ctx.state.view = 'list';
  ctx.state.opener = trigger;
  render(ctx);
  ctx.slide.show(false);
  focusFirstTrip(ctx);
}

/**
 * Opens one trip at a day and fits the map to the whole trip.
 * @param {Context} ctx
 * @param {{id: string, index?: number, trigger: HTMLElement}} request
 */
function openTrip(ctx, { id, index, trigger }) {
  const trip = ctx.state.trips.get(id);
  if (!trip) return;
  Object.assign(ctx.state, { currentId: id, view: 'trip', opener: trigger });
  if (Number.isInteger(index) && trip.days[index]) trip.index = index;
  ctx.options.closePopup();
  render(ctx);
  ctx.slide.show(true);
  ctx.options.onFit(tripPoints(trip, ctx.options.geometry));
  const current = $('[aria-current="step"]', ctx.content);
  current?.focus(NO_SCROLL);
  // Scroll only the day list: scrollIntoView would also scroll the map area
  // to reach the panel while it is still sliding in from off-screen.
  const day = /** @type {HTMLElement | null} */ (current?.closest('.itinerary-day'));
  ctx.content.scrollTop =
    day && trip.index > 0 ? day.offsetTop - ctx.content.offsetTop - DAY_SCROLL_MARGIN : 0;
}

/** @param {Context} ctx @param {number} index */
function selectDay(ctx, index) {
  const trip = ctx.currentTrip(),
    day = trip?.days[index];
  if (!day) return;
  trip.index = index;
  render(ctx);
  $('[aria-current="step"]', ctx.content)?.focus(NO_SCROLL);
  ctx.options.onFit(dayPoints(day, ctx.options.geometry));
}

/**
 * Trip, day photo and day buttons inside the panel.
 * @param {Context} ctx
 * @param {MouseEvent} event
 */
function contentClick(ctx, event) {
  const target = /** @type {Element} */ (event.target);
  const trip = /** @type {HTMLElement | null} */ (target.closest('[data-open-trip]'));
  if (trip) {
    const id = trip.dataset.openTrip;
    openTrip(ctx, { id, index: ctx.state.trips.get(id)?.index, trigger: ctx.state.opener });
    return;
  }
  const photo = /** @type {HTMLElement | null} */ (target.closest('[data-day-photo]'));
  if (photo) {
    const list = ctx.dayPhotos.get(ctx.currentTrip())[Number(photo.dataset.dayPhoto)] || [];
    ctx.options.showPhotos(rotate(list, Number(photo.dataset.photoIndex)).map(item => item.id));
    return;
  }
  const day = /** @type {HTMLElement | null} */ (target.closest('[data-select-day]'));
  if (day) selectDay(ctx, Number(day.dataset.selectDay));
}

/** @param {Context} ctx */
function bindEvents(ctx) {
  const { content, panel } = ctx;
  ctx.launcher.addEventListener('click', () => openList(ctx, ctx.launcher));
  ctx.back.addEventListener('click', () => {
    ctx.state.view = 'list';
    render(ctx);
    focusFirstTrip(ctx);
  });
  content.addEventListener('click', event => contentClick(ctx, event));
  content.addEventListener('pointerover', event => ctx.highlight(event.target));
  content.addEventListener('pointerleave', () => ctx.highlight(null));
  content.addEventListener('focusin', event => ctx.highlight(event.target));
  content.addEventListener('focusout', event => {
    if (!content.contains(/** @type {Node | null} */ (event.relatedTarget))) ctx.highlight(null);
  });
  ctx.closeButton.addEventListener('click', () => closePanel(ctx));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel(ctx);
    }
    event.stopPropagation();
  });
}

/**
 * Installs the itinerary panel and its toolbar launcher.
 * @param {ItineraryOptions} options
 */
export function installTripItineraries(options) {
  const elements = findElements();
  if (!elements) return INERT_ITINERARIES;
  const ctx = createContext(elements, options);
  const { state } = ctx;
  bindEvents(ctx);
  /** Route card details for the trip a record belongs to. */
  const card = context =>
    context
      ? {
          id: context.trip.id,
          title: context.trip.title,
          noun: 'day',
          steps: context.trip.days.map(day => ({ label: day.label, stop: day.title })),
          index: context.index
        }
      : null;
  /** Follows the trip day of a route the map opened. */
  const sync = context => {
    if (!context) return;
    const changed = state.currentId !== context.trip.id || context.trip.index !== context.index;
    state.currentId = context.trip.id;
    context.trip.index = context.index;
    if (changed && ctx.panel.open && state.view === 'trip') render(ctx);
  };
  return {
    load: (definitions, journeys, transport, flightLog) =>
      loadTrips(ctx, { definitions, journeys, transport, flightLog }),
    card,
    open: (id = state.currentId, index = undefined, trigger = ctx.launcher) =>
      openTrip(ctx, { id, index, trigger }),
    openList: (trigger = ctx.launcher) => openList(ctx, trigger),
    close: () => closePanel(ctx),
    sync,
    isOpen: ctx.slide.isOpen,
    forActivity: record => state.activityRefs.get(record.id),
    forTransport: record => state.transportRefs.get(record.id),
    refresh: () => {
      if (ctx.panel.open) render(ctx);
    }
  };
}
