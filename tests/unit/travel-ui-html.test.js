import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesHtml, cardHtml, statHtml } from '../../assets/js/travel/ui/route-card-html.js';
import { legHtml, tripHtml, tripListHtml } from '../../assets/js/travel/ui/itinerary-html.js';
import { icon } from '../../assets/js/travel/ui/route-icons.js';

const EVIL = '"><img src=x onerror=alert(1)>';
const formatDistance = (km, precision) => [km.toFixed(precision), 'Km'];
const thumbnail = photo => `/t/${photo.id}`;

test('icon falls back to the car glyph for unknown and inherited keys', () => {
  assert.equal(icon('nope'), icon('Drive'));
  assert.equal(icon('toString'), icon('Drive'));
  assert.notEqual(icon('Flight'), icon('Drive'));
});

test('attributesHtml escapes map values and passes markup strings through', () => {
  assert.equal(
    attributesHtml({ 'data-x': EVIL, hidden: true, skip: false }),
    `data-x="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" hidden`
  );
  assert.equal(attributesHtml('data-day="1"'), 'data-day="1"');
  assert.equal(attributesHtml(undefined), '');
});

test('statHtml keeps raw distances for unit changes', () => {
  assert.equal(
    statHtml({ distanceKm: 2.5, precision: 1 }, formatDistance),
    '<div data-distance-km="2.5" data-distance-precision="1"><b>2.5</b><small>Km</small></div>'
  );
  assert.equal(
    statHtml(['<1', 'Hours'], formatDistance),
    '<div><b>&lt;1</b><small>Hours</small></div>'
  );
});

test('cardHtml escapes every interpolated field', () => {
  const html = cardHtml(
    {
      modeKey: 'Bus',
      modeName: EVIL,
      color: `red;" onclick="x`,
      context: EVIL,
      title: EVIL,
      quote: EVIL,
      stops: [EVIL, 'b', 'c'],
      stats: [[EVIL, EVIL]],
      services: [{ title: EVIL, subtitle: EVIL, duration: EVIL }],
      rowsLabel: EVIL,
      rows: [{ cells: [EVIL] }, { cells: ['x'], attrs: { 'data-connection': EVIL } }],
      photos: [{ id: EVIL, place: EVIL, variants: {} }],
      stepper: { index: 0, total: 2 },
      trip: { id: EVIL, title: 't', noun: EVIL, index: 0, steps: [{}] }
    },
    { formatDistance, thumbnail }
  );
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('" onclick'));
  assert.ok(html.includes('class="route-card bus-card trip-card"'));
  assert.ok(html.includes('<button data-step="-1" disabled>'));
});

const format = {
  mode: key => ({ name: `<${key}>`, color: `#000" x="` }),
  distance: km => `${km} km`,
  thumbnail
};

test('legHtml escapes kind, ids, colors and stats', () => {
  const html = legHtml(
    {
      kind: /** @type {any} */ (EVIL),
      id: EVIL,
      mode: 'Bus',
      title: EVIL,
      detail: EVIL,
      distanceKm: 3,
      elapsed: 3600,
      elevation: 120
    },
    format
  );
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('" x="'));
  assert.match(html, /<span>1:00 h<\/span>/);
  assert.match(html, /<span>↑ 120 m<\/span>/);
});

test('trip list and trip views escape their content', () => {
  const day = {
    label: 'Day 1',
    title: EVIL,
    date: '2024-05-01',
    places: [],
    legs: [{ kind: 'activity', id: 'a', mode: 'hiking', title: 'Walk', distanceKm: 4 }]
  };
  const trip = {
    id: 'trip',
    title: EVIL,
    note: EVIL,
    noun: 'day',
    days: [day],
    steps: [day],
    index: 0
  };
  const list = tripListHtml([trip], () => undefined, format);
  const view = tripHtml(trip, [[{ id: 'p', place: EVIL, variants: {} }]], format);
  for (const html of [list, view]) assert.ok(!html.includes('<img src=x'));
  assert.match(list, /1 day ·/);
  assert.match(view, /aria-current="step"/);
  assert.match(view, /4 km on foot/);
  assert.match(view, /data-day-photo="0" data-photo-index="0"/);
});
