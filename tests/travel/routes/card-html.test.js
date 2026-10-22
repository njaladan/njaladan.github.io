import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesHtml, cardHtml, statHtml } from '../../../assets/js/travel/routes/card-html.js';

const EVIL = '"><img src=x onerror=alert(1)>';

const formatDistance = (km, precision) => [km.toFixed(precision), 'Km'];

const thumbnail = photo => `/t/${photo.id}`;

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
