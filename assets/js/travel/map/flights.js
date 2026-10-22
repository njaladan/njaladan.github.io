import { ROUTE_MODES } from '../shared/data.js';
import { escapeHtml } from '../../lib/html.js';
import { CARD_OPTIONS } from './constants.js';
import { airportContent, flightContent } from './card-content.js';
import { middlePoint } from './geometry.js';
import { asButton } from './keyboard.js';

// Flight connections and airport badges, each opening its own card.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

const QUIET = { color: ROUTE_MODES.Flight.color, weight: 1.5, opacity: 0.43 };
const EMPHASIS = { weight: 2.2, opacity: 0.8 };
// A focused airport badge rises above its neighbours.
const FOCUS_Z_OFFSET = 1000;

/**
 * Draws one connection between two airports.
 * @param {AtlasContext} ctx
 * @param {any} connection
 */
function renderConnection(ctx, connection) {
  const { L, layers } = ctx;
  const label = connection.airports.join(' ↔ ');
  // Flight geometry follows sorted airport codes, not necessarily the flown direction.
  // Use the first recorded flight to keep shared return connections flowing one way.
  const flight = ctx.state.flightLog.flights[connection.flights[0]];
  const direction = flight.from === connection.airports[0] ? '' : ' route-flow-reverse';
  const line = L.polyline(connection.segments, {
    pane: 'flights',
    ...QUIET,
    className: `flight-route route-flow${direction}`
  })
    .bindTooltip(escapeHtml(label))
    .bindPopup(() => flightContent(ctx, connection), CARD_OPTIONS)
    .addTo(layers.flights);
  layers.flightLines.push(line);
  layers.routeHover.set(`flight:${connection.airports.join('-')}`, () => [line.getElement()]);
  layers.routeEntries.flights.push({
    mode: 'Flight',
    bounds: connection.segments.map(segment => L.latLngBounds(segment)),
    layers: [line]
  });
  const highlight = () => {
    line.setStyle(EMPHASIS);
    line.getElement().classList.add('flight-emphasis');
  };
  const reset = () => {
    line.setStyle(QUIET);
    line.getElement().classList.remove('flight-emphasis');
  };
  const settle = () => {
    if (!line.isPopupOpen()) reset();
  };
  line.on('mouseover popupopen', highlight).on('mouseout', settle).on('popupclose', reset);
  const node = line.getElement();
  asButton(node, label, () => line.openPopup(L.latLng(middlePoint(connection.segments[0]))));
  node.addEventListener('focus', highlight);
  node.addEventListener('blur', settle);
}

/**
 * Draws one airport badge.
 * @param {AtlasContext} ctx
 * @param {string} code
 * @param {any} airport
 */
function renderAirport(ctx, code, airport) {
  const { L, layers } = ctx;
  const marker = L.marker(airport.coords, {
    pane: 'airports',
    icon: ctx.cards.airportBadge(code, ROUTE_MODES.Flight.color),
    riseOnHover: true
  })
    .bindPopup(() => airportContent(ctx, code), CARD_OPTIONS)
    .addTo(layers.airports);
  const node = marker.getElement();
  asButton(node, `${airport.city} · ${code} · View flights`, () => marker.openPopup(), {
    focusable: false
  });
  node.addEventListener('focus', () => marker.setZIndexOffset(FOCUS_Z_OFFSET));
  node.addEventListener('blur', () => marker.setZIndexOffset(0));
  layers.airportMarkers.push({
    marker,
    flights: ctx.state.flightLog.flights.filter(item => item.from === code || item.to === code)
      .length
  });
}

/**
 * Draws every flight connection and airport; busier airports label first.
 * @param {AtlasContext} ctx
 */
export function renderFlights(ctx) {
  const { layers } = ctx,
    { flightLog } = ctx.state;
  layers.flights.clearLayers();
  layers.airports.clearLayers();
  layers.routeEntries.flights.length = 0;
  layers.airportMarkers.length = 0;
  flightLog.routes.forEach(connection => renderConnection(ctx, connection));
  Object.entries(flightLog.airports).forEach(([code, airport]) =>
    renderAirport(ctx, code, airport)
  );
  layers.airportMarkers.sort((a, b) => b.flights - a.flights);
}
