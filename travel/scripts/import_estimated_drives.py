"""Save estimated bus and driving paths along OpenStreetMap roads.

Trip order comes from travel records and the itinerary matching the booked
Tunisia tour. These are reconstructions, not recorded GPS tracks. The routing
cache is local; published data contains no email or booking identifiers.
"""
import argparse
import json
from pathlib import Path

from build_transport_routes import ROOT, meters, routed, simplify

# Saved routes replaced by a revised trip.
REPLACED_IDS = {'tunisia-sahara-day-1', 'tunisia-sahara-day-2'}
# The Sabria camp pin is the nearest paved-road point; the camp sits off the road.
TRIPS = [
    {
        'id': 'washington-dc-new-haven',
        'name': 'Washington, DC → New Haven',
        'countries': ['840'],
        'stops': ['Washington, DC', 'New Haven'],
        'points': [[38.9072, -77.0369], [41.3083, -72.9279]],
        'note': 'Estimated main-road route; not a GPS recording.',
    },
    {
        'id': 'nyc-providence',
        'name': 'NYC → Providence',
        'countries': ['840'],
        'stops': ['NYC', 'Providence'],
        'points': [[40.7128, -74.0060], [41.8240, -71.4128]],
        'note': 'Estimated main-road route; not a GPS recording.',
    },
    {
        'id': 'nyc-mt-marcy',
        'name': 'NYC → Mount Marcy trailhead',
        'countries': ['840'],
        'stops': ['NYC', 'Adirondack Loj (Mount Marcy trailhead)'],
        'points': [[40.7128, -74.0060], [44.1827, -73.9654]],
        'note': 'Estimated main-road route to Adirondack Loj, the Mount Marcy trailhead; not a GPS recording. The summit is reached on foot.',
    },
    {
        'id': 'nyc-acadia',
        'mode': 'Bus',
        'name': 'NYC → Boston → Acadia National Park',
        'countries': ['840'],
        'stops': ['NYC', 'Boston', 'Hulls Cove Visitor Center'],
        'points': [[40.7128, -74.0060], [42.3601, -71.0589], [44.3908, -68.2082]],
        'note': 'Estimated main-road route through Boston to the Hulls Cove Visitor Center; not a GPS recording.',
    },
    {
        'id': 'san-jose-sequoia-kings-canyon',
        'name': 'San Jose → Kings Canyon & Sequoia National Parks',
        'countries': ['840'],
        'stops': ['San Jose', 'Kings Canyon National Park (Grant Grove)', 'Sequoia National Park (General Sherman Tree)'],
        'points': [[37.3382, -121.8863], [36.7378, -118.9637], [36.6040, -118.7370]],
        'note': 'Estimated main-road route through Grant Grove in Kings Canyon National Park and the General Sherman Tree area in Sequoia National Park; not a GPS recording.',
    },
    {
        'id': 'las-vegas-zion',
        'name': 'Las Vegas → Zion National Park',
        'countries': ['840'],
        'stops': ['Las Vegas', 'Zion Canyon Visitor Center (Springdale)'],
        'points': [[36.1699, -115.1398], [37.2000, -112.9870]],
        'note': 'Estimated main-road route to the Zion Canyon Visitor Center in Springdale; not a GPS recording.',
    },
    {
        'id': 'las-vegas-irvine',
        'name': 'Las Vegas → Irvine',
        'countries': ['840'],
        'stops': ['Las Vegas', 'Irvine'],
        'points': [[36.1699, -115.1398], [33.6846, -117.8265]],
        'note': 'Estimated main-road route; not a GPS recording.',
    },
    {
        'id': 'asheville-nashville-via-smokies',
        'name': 'Asheville → Nashville via Great Smoky Mountains',
        'countries': ['840'],
        'stops': ['Asheville', 'Great Smoky Mountains National Park (Sugarlands Visitor Center)', 'Nashville'],
        'points': [[35.5951, -82.5515], [35.6862, -83.5369], [36.1627, -86.7816]],
        'note': 'Estimated main-road route via the Sugarlands Visitor Center in Great Smoky Mountains National Park; not a GPS recording.',
    },
    {
        'id': 'athens-meteora-road-trip',
        'mode': 'Bus',
        'name': 'Athens → Meteora',
        'countries': ['300'],
        'stops': ['Athens', 'Meteora'],
        'points': [[37.9838, 23.7275], [39.721, 21.628]],
        'note': 'Estimated main-road route via A1, A3, and the Meteora–Kastraki road; not a GPS recording.',
    },
    {
        'id': 'jordan-aqaba-wadi-rum',
        'name': 'Aqaba → Wadi Rum',
        'countries': ['400'],
        'stops': ['Aqaba', 'Wadi Rum Visitor Center', 'Wadi Rum'],
        'points': [[29.5321, 35.0063], [29.6397, 35.4342], [29.5734, 35.421]],
    },
    {
        'id': 'jordan-wadi-rum-petra',
        'name': 'Wadi Rum → Petra / Wadi Musa',
        'countries': ['400'],
        'stops': ['Wadi Rum', 'Wadi Musa'],
        'points': [[29.5734, 35.421], [30.3216, 35.4801]],
    },
    {
        'id': 'jordan-petra-amman',
        'name': 'Petra / Wadi Musa → Amman via Wadi Mujib and the Dead Sea',
        'countries': ['400'],
        'stops': ['Wadi Musa', 'Wadi Mujib Adventure Center', 'Dead Sea', 'Amman'],
        # The Dead Sea point sits on the Dead Sea Highway (Route 65) by the Amman
        # Tourist Beach strip. An earlier point inside the Sweimeh resort access
        # roads made the router loop through the hotel lanes and back out (~15 km).
        'points': [[30.3216, 35.4801], [31.4676824, 35.5715571],
                   [31.718785, 35.590326], [31.9539, 35.9106]],
    },
    {
        'id': 'jordan-wadi-rum-1917-train',
        'mode': 'Train',
        'name': 'Wadi Rum 1917 train',
        'countries': ['400'],
        'stops': ['Wadi Rum station', 'Ad Disi'],
        # Wadi Rum station (OSM node 10723656664) on the Aqaba railway, east along
        # the line to the Ad Disi / Shakriyya platform where the reenactment ride runs.
        'points': [[29.6995225, 35.3965375], [29.66036, 35.48264]],
        'note': 'Approximate: the Hejaz Railway heritage ("1917") train ride, drawn along the '
                'OpenStreetMap railway between Wadi Rum station and Ad Disi. Published accounts '
                'disagree on where the ~14 km ride starts and turns back; not a GPS recording.',
    },
    {
        'id': 'pudeto-natales',
        'mode': 'Bus',
        'name': 'Pudeto → Puerto Natales',
        'countries': ['152'],
        'stops': ['Pudeto', 'Puerto Natales'],
        'points': [[-51.0628048, -72.9903369], [-51.730869, -72.497715]],
        'note': 'Estimated road route from the Pudeto catamaran dock to the Puerto Natales bus terminal; not a GPS recording.',
    },
    {
        'id': 'tunisia-sahara-tour',
        'mode': 'Bus',
        'name': 'Tunisia Sahara tour',
        'countries': ['788'],
        'operator': 'Tours sans soucis',
        'stops': ['Tunis', 'El Jem', 'Matmata', 'Dunes Insolites Desert Camp (Sabria)',
                  'Chott El Jerid', 'Chebika', 'Kairouan', 'Tunis'],
        'points': [[36.8065, 10.1815], [35.2965, 10.7064], [33.5445, 9.9716],
                   [33.3486, 8.7480], [33.9161, 8.5107], [34.3167, 7.9333],
                   [35.6781, 10.0963], [36.8065, 10.1815]],
        'note': 'Estimated road route; not a GPS recording. Stop order from the traveler; roads inferred from the fastest main route between stops and may differ.',
    },
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--only', nargs='+', help='Save only these trip IDs')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'data/transport.json'
    data = json.loads(target.read_text())
    existing = {trip['id']: trip for trip in data['routes']}
    added = []
    for source in TRIPS:
        if args.only and source['id'] not in args.only:
            continue
        trip = dict(source)
        # Confirmed service details are maintained in the published manifest.
        previous = existing.get(trip['id'], {})
        for field in ('bus', 'operator'):
            if field in previous:
                trip[field] = previous[field]
        points = trip.pop('points')
        mode = trip.get('mode', 'Drive')
        coords = routed(points, mode, args.cache, trip['id'])
        # Refuse a path that silently snaps to another city or loses a stop.
        for stop, point in zip(trip['stops'], points):
            if min(meters(point, coord) for coord in coords) > 1500:
                raise ValueError(f"Route misses {stop}")
        if meters(coords[0], points[0]) > meters(coords[-1], points[0]):
            coords.reverse()
        note = trip.pop('note', None)
        trip.update({
            'mode': mode, 'operator': trip.get('operator', ''),
            'approximate': True,
            'note': note or 'Estimated road route; not a GPS recording. '
                    + ('Stop order from the traveler.' if trip['countries'] == ['400']
                       else 'Stops reconstructed from the booked tour and its published itinerary; actual order may differ.'),
            'geometry_source': 'BRouter rail · OpenStreetMap' if mode == 'Train' else 'OSRM driving · OpenStreetMap',
            'coords': simplify(coords),
        })
        added.append(trip)
        print(trip['name'], len(trip['coords']), 'road vertices', flush=True)
    # Refreshed trips keep their place in the manifest; new trips are appended.
    refreshed = {trip['id']: trip for trip in added}
    data['routes'] = [refreshed.pop(trip['id'], trip) for trip in data['routes'] if trip['id'] not in REPLACED_IDS]
    data['routes'] += list(refreshed.values())
    target.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    print('Saved', len(data['routes']), 'transport routes')


if __name__ == '__main__':
    main()
