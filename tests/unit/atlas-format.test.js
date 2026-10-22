import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityQuote,
  activityTitle,
  airline,
  allPlaces,
  canonical,
  clock,
  countriesLabel,
  countryName,
  formatDuration,
  isVisitedShape,
  mappablePhotos,
  parseAtlasHash,
  plural,
  transportHeading
} from '../../assets/js/travel/atlas/format.js';

test('durations and clock times round to the minute', () => {
  assert.equal(formatDuration(59 * 60), '59m');
  assert.equal(formatDuration(2 * 3600 + 5 * 60 + 20), '2h 5m');
  assert.equal(clock(3600 + 5 * 60), '1:05');
  assert.equal(clock(29), '0:00');
});

test('airline names known carriers only', () => {
  assert.equal(airline('DL123'), 'Delta DL123');
  assert.equal(airline('6E45'), 'IndiGo 6E45');
  assert.equal(airline('ZZ9'), 'ZZ9');
});

test('plural picks the singular for one', () => {
  assert.equal(plural(1, 'Flight', 'Flights'), 'Flight');
  assert.equal(plural(0, 'Flight', 'Flights'), 'Flights');
});

test('countries resolve Hong Kong and skip unvisited ones', () => {
  assert.equal(canonical('344'), '156');
  assert.equal(countryName('840'), 'United States');
  assert.equal(countriesLabel(['344', '999', '250']), 'Hong Kong SAR · France');
  assert.equal(isVisitedShape('156'), false);
  assert.equal(isVisitedShape('344'), true);
});

test('activity titles prefer treks, then places, then countries', () => {
  const tmb = { id: 'tmb', days: [] },
    w = { id: 'chile-activities', days: [] },
    other = { id: 'x', days: [] };
  const day = { name: 'TMB stage 2', type: 'hiking', countries: ['528'] };
  w.days.push({}, day);
  assert.equal(
    activityTitle(day, tmb, () => 'Nowhere'),
    'Tour du Mont Blanc stage 2'
  );
  assert.equal(
    activityTitle(day, w, () => null),
    'W Trek · Day 2'
  );
  assert.equal(
    activityTitle(day, other, () => 'Zermatt'),
    'Hike near Zermatt'
  );
  assert.equal(
    activityTitle({ ...day, type: 'walking' }, other, () => 'Rome'),
    'Walk in Rome'
  );
  assert.equal(
    activityTitle(day, other, () => null),
    'Hike in the Netherlands'
  );
  assert.equal(
    activityTitle({ type: 'yoga' }, other, () => null),
    'Activity'
  );
});

test('only custom names outside treks become quotes', () => {
  assert.equal(activityQuote({ name: 'Morning Run' }, undefined), '');
  assert.equal(activityQuote({ name: 'Sunrise on the ridge' }, undefined), 'Sunrise on the ridge');
  assert.equal(activityQuote({ name: 'Sunrise on the ridge' }, 'W Trek'), '');
});

test('transport headings keep arrow names as titles', () => {
  assert.deepEqual(
    transportHeading({ name: 'Chamonix → Courmayeur · Skyway', stops: ['a', 'b'] }),
    { title: 'Chamonix → Courmayeur', context: ['Skyway'] }
  );
  assert.deepEqual(transportHeading({ name: 'Glacier Express', stops: ['Zermatt', 'x', 'Chur'] }), {
    title: 'Zermatt → Chur',
    context: ['Glacier Express']
  });
});

test('hash routing validates countries and US states', () => {
  assert.deepEqual(parseAtlasHash(''), { country: null, state: null, invalid: false });
  assert.deepEqual(parseAtlasHash('#country=344'), { country: '156', state: null, invalid: false });
  assert.deepEqual(parseAtlasHash('#country=999'), { country: null, state: null, invalid: true });
  const [state] = allPlaces()
    .filter(place => place.state)
    .map(place => place.state);
  assert.deepEqual(parseAtlasHash(`#country=840&state=${state}`), {
    country: '840',
    state,
    invalid: false
  });
  assert.equal(parseAtlasHash('#country=840&state=00').state, null);
  assert.equal(parseAtlasHash(`#country=250&state=${state}`).state, null);
});

test('mappable photos need coordinates and a thumbnail', () => {
  const good = { coords: [1, 2], variants: { thumbnail: { src: 'a.jpg' } } };
  assert.deepEqual(mappablePhotos([good, { coords: [1, 2] }, null, { variants: good.variants }]), [
    good
  ]);
  assert.deepEqual(mappablePhotos(undefined), []);
});
