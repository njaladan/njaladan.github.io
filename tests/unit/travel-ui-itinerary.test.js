import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignDayPhotos,
  buildTrips,
  dayPoints,
  onFootKm,
  rotate,
  tripPoints
} from '../../assets/js/travel/ui/itinerary-model.js';

const journeys = [
  { days: [{ id: 'hike', type: 'hiking', name: 'Ridge', distance_m: 5000, elapsed_s: 7200 }] }
];
const transport = [
  {
    id: 'bus',
    mode: 'Bus',
    name: 'Bus 1 · Town',
    coords: [
      [0, 0],
      [0, 1]
    ]
  }
];
const flightLog = {
  airports: { AAA: { city: 'A', coords: [0, 0] }, BBB: { city: 'B', coords: [0, 10] } }
};
const definitions = {
  trips: [
    { id: 'Bad id', days: [{ legs: [{ activity: 'hike' }] }] },
    {
      id: 'walk',
      title: 'Walk',
      fit: 'activities',
      days: [
        { title: 'Fly', legs: [{ flight: ['BBB', 'AAA'] }, { route: 'bus' }] },
        { title: 'Empty', legs: [{ activity: 'missing' }] },
        {
          title: 'Hike',
          date: '2024-01-02',
          legs: [{ activity: 'hike' }],
          places: [{ name: 'Hut', coords: [1, 1] }, { coords: [0, 0] }]
        }
      ]
    }
  ]
};
const geometry = leg =>
  ({
    hike: [
      [1, 0],
      [1, 0.1]
    ],
    bus: [
      [0, 0],
      [0, 1]
    ],
    'AAA-BBB': [
      [0, 0],
      [0, 10]
    ]
  })[leg.id];

test('buildTrips resolves legs, drops empty days and invalid trips', () => {
  const { trips, activityRefs, transportRefs } = buildTrips(definitions, {
    journeys,
    transport,
    flightLog
  });
  assert.deepEqual([...trips.keys()], ['walk']);
  const trip = trips.get('walk');
  assert.deepEqual(
    trip.days.map(day => day.label),
    ['Day 1', 'Day 3']
  );
  const [flight, bus] = trip.days[0].legs;
  assert.equal(flight.id, 'AAA-BBB');
  assert.equal(flight.title, 'B → A');
  assert.equal(bus.title, 'Bus 1');
  assert.equal(trip.days[1].places.length, 1);
  assert.equal(activityRefs.get('hike').index, 1);
  assert.equal(transportRefs.get('bus').index, 0);
  assert.equal(onFootKm(trip.days[1]), 5);
});

test('tripPoints prefers trails, then ground legs', () => {
  const { trips } = buildTrips(definitions, { journeys, transport, flightLog });
  const trip = trips.get('walk');
  assert.deepEqual(tripPoints(trip, geometry), [
    [1, 0],
    [1, 0.1],
    [1, 1]
  ]);
  assert.equal(dayPoints(trip.days[0], geometry).length, 4);
  assert.deepEqual(tripPoints({ ...trip, fit: undefined }, geometry).length, 5);
});

test('assignDayPhotos matches dated photos by date and undated by distance', () => {
  const { trips } = buildTrips(definitions, { journeys, transport, flightLog });
  const trip = trips.get('walk');
  const photos = [
    { id: 'dated', coords: [1, 0.05], date: '2024-01-02' },
    { id: 'wrong-date', coords: [1, 0.05], date: '2024-01-09' },
    { id: 'bus', coords: [0.01, 0.99] },
    { id: 'far', coords: [40, 40] }
  ];
  const days = assignDayPhotos(trip, photos, geometry);
  assert.deepEqual(
    days.map(list => list.map(photo => photo.id)),
    [['bus'], ['dated']]
  );
});

test('rotate starts a list at an index', () => {
  assert.deepEqual(rotate([1, 2, 3], 1), [2, 3, 1]);
});
