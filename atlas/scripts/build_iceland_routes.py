#!/usr/bin/env python3
"""Connect the recorded Iceland hikes with saved driving paths and ferry access."""
import argparse
import hashlib
import json
from pathlib import Path

from build_transport_routes import ROOT, meters, routed, simplify

LANDEYJAHOFN = [63.530904, -20.116991]
HIKE_PLACES = {
    '16007840862': 'Fagradalsfjall', '16010599630': 'Glymur',
    '16013322986': 'Þingvellir', '16013018406': 'Kerið',
    '16020388694': 'Skógafoss', '16021723026': 'Reynisfjara',
    '16022452871': 'Fjaðrárgljúfur', '16023245494': 'Skaftafell',
    '16029608499': 'Múlagljúfur Canyon', '16034787340': 'Svínafellsjökull',
}


def build_routes(document, activities, cache):
    days = {d['id']: d for j in activities['journeys'] for d in j['days']}
    hikes = sorted((days[id] for id in HIKE_PLACES if id in days), key=lambda d: d['started_at'])
    if not hikes:
        return document
    cache.mkdir(parents=True, exist_ok=True)
    # Replace the old direct drive; leave all other countries' routes intact.
    document['routes'] = [r for r in document['routes'] if r['id'] != 'reykjavik-mulagljufur' and not r['id'].startswith('iceland-drive-')]
    previous = {'name': 'Reykjavík', 'point': [64.1466, -21.9426], 'id': None}
    for hike in hikes:
        destination = {'name': HIKE_PLACES[hike['id']], 'point': hike['segments'][0][0], 'id': hike['id']}
        via = [[63.75, -20.2245]] if previous['id'] == '16013018406' else []
        document['routes'].append(drive_leg(previous, destination, hike['date'], via, cache))
        previous = {'name': destination['name'], 'point': hike['segments'][-1][-1], 'id': hike['id']}
    destination = {'name': 'Landeyjahöfn ferry terminal', 'point': LANDEYJAHOFN, 'id': None}
    document['routes'].append(drive_leg(previous, destination, hikes[-1]['date'], [], cache))
    return document


def drive_leg(origin, destination, date, via, cache):
    slug = f"iceland-drive-{origin['id'] or 'reykjavik'}-{destination['id'] or 'landeyjahofn'}"
    points = [origin['point'], *via, destination['point']]
    fingerprint = hashlib.sha256(json.dumps(points).encode()).hexdigest()[:10]
    coords = routed(points, 'Drive', cache, slug+'-'+fingerprint)
    if meters(coords[0], points[0]) > meters(coords[-1], points[0]):
        coords.reverse()
    offsets = [meters(coords[0], points[0]), meters(coords[-1], points[-1])]
    if max(offsets) > 250:
        raise ValueError(f'{slug}: road access is {max(offsets):.0f} m from the recorded endpoint')
    # Short trailhead/parking connectors meet the recorded GPS endpoints exactly.
    coords = [points[0], *simplify(coords), points[-1]]
    coords = [p for i, p in enumerate(coords) if not i or p != coords[i-1]]
    trip = {'id': slug, 'name': origin['name']+' → '+destination['name'],
            'stops': [origin['name'], *(['Hvolsvöllur'] if via else []), destination['name']],
            'countries': ['352'], 'mode': 'Drive', 'operator': '', 'dates': [date],
            'coords': coords, 'geometry_source': 'OSRM driving · OpenStreetMap',
            'activity_endpoints': {'from': origin['id'], 'to': destination['id']},
            'road_snap_distance_m': [round(offset, 1) for offset in offsets]}
    print(f"{trip['name']}: {len(coords)} vertices, access offsets {offsets[0]:.0f}/{offsets[1]:.0f} m", flush=True)
    return trip


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    transport = ROOT/'data/transport.json'
    document = build_routes(json.loads(transport.read_text()), json.loads((ROOT/'data/activities.json').read_text()), args.cache)
    transport.write_text(json.dumps(document, separators=(',', ':'), ensure_ascii=False)+'\n')
