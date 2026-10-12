"""Save estimated driving paths along OpenStreetMap roads.

Trip order comes from travel records and the itinerary matching the booked
Tunisia tour. These are reconstructions, not recorded GPS tracks. The routing
cache is local; published data contains no email or booking identifiers.
"""
import argparse
import json
from pathlib import Path

from build_transport_routes import ROOT, meters, routed, simplify

TUNISIA_ITINERARY = 'https://www.kkday.com/en/product/806296'
TRIPS = [
    {
        'id': 'athens-meteora-road-trip',
        'name': 'Athens → Meteora',
        'countries': ['300'], 'dates': [],
        'stops': ['Athens', 'Meteora'],
        'points': [[37.9838, 23.7275], [39.721, 21.628]],
        'note': 'Estimated main-road route via A1, A3, and the Meteora–Kastraki road; not a GPS recording.',
    },
    {
        'id': 'jordan-aqaba-wadi-rum',
        'name': 'Aqaba → Wadi Rum',
        'countries': ['400'], 'dates': ['2026-08-26'],
        'stops': ['Aqaba', 'Wadi Rum Visitor Center', 'Wadi Rum'],
        'points': [[29.5321, 35.0063], [29.6397, 35.4342], [29.5734, 35.421]],
    },
    {
        'id': 'jordan-wadi-rum-petra',
        'name': 'Wadi Rum → Petra / Wadi Musa',
        'countries': ['400'], 'dates': ['2026-08-27'],
        'stops': ['Wadi Rum', 'Wadi Musa'],
        'points': [[29.5734, 35.421], [30.3216, 35.4801]],
    },
    {
        'id': 'jordan-petra-amman',
        'name': 'Petra / Wadi Musa → Amman via Wadi Mujib and the Dead Sea',
        'countries': ['400'], 'dates': ['2026-08-28'],
        'stops': ['Wadi Musa', 'Wadi Mujib Adventure Center', 'Dead Sea', 'Amman'],
        'points': [[30.3216, 35.4801], [31.4676824, 35.5715571],
                   [31.7509267, 35.5897894], [31.9539, 35.9106]],
    },
    {
        'id': 'tunisia-sahara-day-1',
        'name': 'Tunisia Sahara tour · Day 1',
        'countries': ['788'], 'dates': ['2026-08-30'],
        'operator': 'Tours sans soucis',
        'stops': ['Tunis airport', 'Kairouan', 'Matmata', 'Tamezret', 'Ksar Ghilane'],
        'points': [[36.851, 10.2272], [35.6781, 10.0963], [33.5445, 9.9716],
                   [33.5353, 9.865], [32.9855, 9.6371]],
        'itinerary_url': TUNISIA_ITINERARY,
    },
    {
        'id': 'tunisia-sahara-day-2',
        'name': 'Tunisia Sahara tour · Day 2',
        'countries': ['788'], 'dates': ['2026-08-31'],
        'operator': 'Tours sans soucis',
        'stops': ['Ksar Ghilane', 'Tataouine', 'Chenini', 'Ksar Haddada', 'El Jem', 'Tunis airport'],
        'points': [[32.9855, 9.6371], [32.9297, 10.4518], [32.9111, 10.2619],
                   [33.0075, 10.2893], [35.296, 10.7075], [36.851, 10.2272]],
        'itinerary_url': TUNISIA_ITINERARY,
    },
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'data/transport.json'
    data = json.loads(target.read_text())
    added = []
    for source in TRIPS:
        trip = dict(source)
        points = trip.pop('points')
        coords = routed(points, 'Drive', args.cache, trip['id'])
        # Refuse a path that silently snaps to another city or loses a stop.
        for stop, point in zip(trip['stops'], points):
            if min(meters(point, coord) for coord in coords) > 1500:
                raise ValueError(f"Route misses {stop}")
        if meters(coords[0], points[0]) > meters(coords[-1], points[0]):
            coords.reverse()
        note = trip.pop('note', None)
        trip.update({
            'mode': 'Drive', 'operator': trip.get('operator', ''),
            'approximate': True,
            'note': note or 'Estimated road route; not a GPS recording. '
                    + ('Stop order inferred from travel records.' if trip['countries'] == ['400']
                       else 'Stops reconstructed from the booked tour and its published itinerary; actual order may differ.'),
            'geometry_source': 'OSRM driving · OpenStreetMap',
            'coords': simplify(coords),
        })
        added.append(trip)
        print(trip['name'], len(trip['coords']), 'road vertices', flush=True)
    ids = {trip['id'] for trip in added}
    data['routes'] = [trip for trip in data['routes'] if trip['id'] not in ids] + added
    target.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    print('Saved', len(data['routes']), 'transport routes')


if __name__ == '__main__':
    main()
