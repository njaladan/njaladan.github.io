import { escapeHtml } from '../lib/html.js';
import { travelAsset } from './runtime.js';

// Route cards: one popup layout shared by activities, transport, flights and
// airports, plus the route badges and geometry helpers the map uses for them.
export function installRouteCards(L = window.L) {
  const ICONS = {
    hiking: '<path d="M1.5 13 6 5.5l2.6 4L10.6 7l3.9 6z" fill="currentColor"/>',
    walking:
      '<ellipse cx="5.6" cy="5.4" rx="1.7" ry="2.6" fill="currentColor"/><ellipse cx="10.4" cy="10.4" rx="1.7" ry="2.6" fill="currentColor"/>',
    running:
      '<path d="m4 3.5 5 4.5-5 4.5M8.5 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    cycling:
      '<circle cx="4" cy="10.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="10.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 10.5 6.5 6h4l1.5 4.5M6.5 6 8.5 10.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    Train:
      '<rect x="4" y="2.5" width="8" height="9" rx="2" fill="currentColor"/><rect x="5.5" y="4" width="5" height="3" rx=".6" fill="var(--mode)"/><path d="m5 13.5 1.5-2M11 13.5l-1.5-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    Drive:
      '<path d="M2.5 10.5V8.3L4 5.2h8l1.5 3.1v2.2z" fill="currentColor"/><circle cx="5" cy="11" r="1.4" fill="currentColor"/><circle cx="11" cy="11" r="1.4" fill="currentColor"/><path d="M5 6.3h6l.8 1.8H4.2z" fill="var(--mode)"/>',
    Bus: '<rect x="3" y="2" width="10" height="10" rx="2" fill="currentColor"/><rect x="4.3" y="4" width="7.4" height="4" rx=".5" fill="var(--mode)"/><circle cx="5" cy="10" r=".8" fill="var(--mode)"/><circle cx="11" cy="10" r=".8" fill="var(--mode)"/><path d="M5 12v1M11 12v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    Ferry:
      '<path d="M2 9h12l-1.8 3.2H3.8z" fill="currentColor"/><path d="M5 9V6h5l1.5 3" fill="currentColor"/><path d="M1.5 14c1.2-.8 2.3-.8 3.5 0s2.3.8 3.5 0 2.3-.8 3.5 0" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
    Gondola:
      '<path d="m1.5 3.5 13 2.5M8 4.8v2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="4.5" y="7.2" width="7" height="6" rx="1.4" fill="currentColor"/><rect x="5.8" y="8.4" width="4.4" height="2.2" rx=".4" fill="var(--mode)"/>',
    Flight:
      '<path d="M14 8.6 9 6.4V3a1 1 0 0 0-2 0v3.4L2 8.6v1.3l5-1.3v3l-1.5 1.1v1l2.5-.6 2.5.6v-1L9 11.6v-3l5 1.3z" fill="currentColor"/>'
  };
  const icon = key =>
    `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[key] || ICONS.Drive}</svg>`;
  let distanceUnit = 'km';
  const distance = (distanceKm, precision = 0) => ({ distanceKm, precision });
  function formatDistance(distanceKm, precision) {
    const value = distanceUnit === 'mi' ? distanceKm / 1.609344 : distanceKm;
    return [
      value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
      }),
      distanceUnit === 'mi' ? 'Miles' : 'Km'
    ];
  }
  function statHtml(stat) {
    const isDistance = Number.isFinite(stat.distanceKm);
    const [value, label] = isDistance ? formatDistance(stat.distanceKm, stat.precision) : stat;
    return `<div${isDistance ? ` data-distance-km="${stat.distanceKm}" data-distance-precision="${stat.precision}"` : ''}><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`;
  }
  function setDistanceUnit(unit) {
    distanceUnit = unit === 'mi' ? 'mi' : 'km';
    document.querySelectorAll('.card-stats [data-distance-km]').forEach(node => {
      const [value, label] = formatDistance(
        Number(node.dataset.distanceKm),
        Number(node.dataset.distancePrecision)
      );
      node.querySelector('b').textContent = value;
      node.querySelector('small').textContent = label;
    });
  }

  // card: {modeKey, modeName, color, context, title, quote, subtitle, note, stops,
  //        stats: [[value, label] or distance(km, precision)], rowsLabel,
  //        rows: [{cells, attrs}], services: [{title, subtitle, duration}], photos, stepper,
  //        trip: {id, title, noun, index, steps: [{label, stop}]}, attrs}
  function html(card) {
    const rows = card.rows?.length
      ? `${card.rowsLabel ? `<p class="card-rows-label card-label">${escapeHtml(card.rowsLabel)}</p>` : ''}<ol class="card-rows">${card.rows.map(row => `<li>${row.attrs ? `<button class="card-row" ${row.attrs}>` : '<div class="card-row">'}${row.cells.map(cell => `<span>${escapeHtml(cell)}</span>`).join('')}${row.attrs ? '<svg class="card-row-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>' : '</div>'}</li>`).join('')}</ol>`
      : '';
    const photos = card.photos?.length
      ? `<div class="card-photos"><span class="card-label">Taken along the way</span>${card.photos
          .slice(0, 4)
          .map(
            photo =>
              `<button class="card-print" data-photo="${escapeHtml(photo.id)}" aria-label="Open photo: ${escapeHtml(photo.gallery?.subject || photo.place)}"><img src="${escapeHtml(travelAsset(photo.variants.thumbnail.src))}" alt=""></button>`
          )
          .join(
            ''
          )}${card.photos.length > 4 ? `<span class="card-more">+${card.photos.length - 4}</span>` : ''}</div>`
      : '';
    const services = card.services?.length
      ? `<section class="card-services" aria-label="Bus journeys">${card.services.map(service => `<article class="card-service"><div class="card-service-heading"><h3>${escapeHtml(service.title)}</h3>${service.duration ? `<span class="card-service-duration">${escapeHtml(service.duration)}</span>` : ''}</div>${service.subtitle ? `<p class="card-service-operator">${escapeHtml(service.subtitle)}</p>` : ''}</article>`).join('')}</section>`
      : '';
    return `<div class="route-card${card.modeKey === 'Bus' ? ' bus-card' : ''}${card.trip ? ' trip-card' : ''}" style="--mode:${card.color}" ${card.attrs || ''}>
      <div class="card-head"><span class="card-icon">${icon(card.modeKey)}</span><span>${escapeHtml(card.modeName)}</span>${card.context ? `<span class="card-context">${escapeHtml(card.context)}</span>` : ''}</div>
      <h2 class="card-title">${escapeHtml(card.title)}</h2>
      ${card.quote ? `<p class="card-quote">“${escapeHtml(card.quote)}”</p>` : ''}
      ${card.subtitle ? `<p class="card-sub">${escapeHtml(card.subtitle)}</p>` : ''}
      ${card.note ? `<p class="card-note">${escapeHtml(card.note)}</p>` : ''}
      ${card.stops?.length > 2 ? `<ol class="card-stops${card.stops.length > 7 ? ' card-stops-long' : ''}">${card.stops.map(stop => `<li title="${escapeHtml(stop)}"><span>${escapeHtml(stop)}</span></li>`).join('')}</ol>` : ''}
      ${card.stats.length ? `<div class="card-stats">${card.stats.map(statHtml).join('')}</div>` : ''}
      ${services}${rows}${photos}
      ${card.stepper ? `<div class="card-nav"><button data-step="-1" ${card.stepper.index === 0 ? 'disabled' : ''}>← Previous</button><button data-step="1" ${card.stepper.index === card.stepper.total - 1 ? 'disabled' : ''}>Next →</button></div>` : ''}
      ${card.trip ? `<button type="button" class="card-itinerary" data-itinerary="${escapeHtml(card.trip.id)}" data-trip-step="${card.trip.index}" aria-haspopup="dialog" aria-controls="trip-itinerary"><span>View full itinerary</span><span>${card.trip.steps.length} ${escapeHtml(card.trip.noun)}${card.trip.steps.length === 1 ? '' : 's'} →</span></button>` : ''}
    </div>`;
  }

  function badge(key, color) {
    return L.divIcon({
      className: 'route-badge',
      html: `<span style="--mode:${color}">${icon(key)}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }
  function airportBadge(code, color) {
    return L.divIcon({
      className: 'airport-marker',
      html: `<span class="airport-badge" style="--mode:${color}">${icon('Flight')}</span><span class="airport-code" aria-hidden="true">${escapeHtml(code)}</span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -14]
    });
  }
  // Point halfway along a path by distance, where its badge sits.
  function midpoint(coords) {
    const d = [0];
    for (let i = 1; i < coords.length; i++)
      d.push(
        d[i - 1] + Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1])
      );
    const half = d[d.length - 1] / 2;
    return coords[
      Math.max(
        0,
        d.findIndex(value => value >= half)
      )
    ];
  }
  const haversine = (a, b) => {
    const rad = Math.PI / 180;
    const h =
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  function km(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
    return total;
  }
  function photosNear(photos, coords, radiusKm) {
    const step = Math.max(1, Math.floor(coords.length / 400));
    return photos.filter(photo => {
      for (let i = 0; i < coords.length; i += step)
        if (haversine(photo.coords, coords[i]) < radiusKm) return true;
      return false;
    });
  }
  return {
    html,
    icon,
    badge,
    airportBadge,
    midpoint,
    km,
    haversine,
    photosNear,
    distance,
    formatDistance,
    setDistanceUnit
  };
}
