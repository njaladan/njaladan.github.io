import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legHtml, tripHtml, tripListHtml } from '../../../assets/js/travel/itineraries/html.js';

const EVIL = '"><img src=x onerror=alert(1)>';

const thumbnail = photo => `/t/${photo.id}`;

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
