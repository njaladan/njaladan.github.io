#!/usr/bin/env python3
"""Connect the recorded Iceland hikes with saved driving paths and ferry access.

Leg order is the traveler's own account of the trip:
  Day 1  KEF → Fagradalsfjall → (Reykjavík) → Glymur → Þingvellir → Kerið → Hvolsvöllur
  Day 2  Hvolsvöllur → Skógafoss → Reynisfjara → Fjaðrárgljúfur
  Day 3  Fjaðrárgljúfur → Skaftafell → Falljökull → Múlagljúfur → Landeyjahöfn (ferry to Heimaey)
  Day 4  Heimaey hike, ferry back, Landeyjahöfn → KEF
Drive ends that meet a recorded hike start/finish exactly at that GPS point.
"""
import argparse
import hashlib
import json
from pathlib import Path

from build_transport_routes import ROOT, meters, routed, simplify

# OSRM no longer routes into the terminal forecourt; use the airport rental-car road (Skýlabraut).
KEF = {'name': 'Keflavík International Airport', 'point': [63.978369, -22.585857]}
# On Kringlumýrarbraut, so the drive passes through the city instead of a downtown out-and-back spur.
REYKJAVIK = [64.130166, -21.899881]
HVOLSVOLLUR = {'name': 'Hvolsvöllur', 'point': [63.75, -20.2245]}
LANDEYJAHOFN = {'name': 'Landeyjahöfn ferry terminal', 'point': [63.530904, -20.116991]}
HIKE_PLACES = {
    '16007840862': 'Fagradalsfjall', '16010599630': 'Glymur',
    '16013322986': 'Þingvellir', '16013018406': 'Kerið',
    '16020388694': 'Skógafoss', '16021723026': 'Reynisfjara',
    '16022452871': 'Fjaðrárgljúfur', '16023245494': 'Skaftafell',
    # The track climbs the Virkisá valley onto the ice inside OSM's Falljökull polygon.
    '16034787340': 'Falljökull', '16029608499': 'Múlagljúfur Canyon',
}
# (id, origin, destination, via stops) — a str endpoint is a hike activity id.
LEGS = [
    ('iceland-drive-kef-fagradalsfjall', KEF, '16007840862', []),
    ('iceland-drive-fagradalsfjall-glymur', '16007840862', '16010599630', [('Reykjavík', REYKJAVIK)]),
    ('iceland-drive-glymur-thingvellir', '16010599630', '16013322986', []),
    ('iceland-drive-thingvellir-kerid', '16013322986', '16013018406', []),
    ('iceland-drive-kerid-hvolsvollur', '16013018406', HVOLSVOLLUR, []),
    ('iceland-drive-hvolsvollur-skogafoss', HVOLSVOLLUR, '16020388694', []),
    ('iceland-drive-skogafoss-reynisfjara', '16020388694', '16021723026', []),
    ('iceland-drive-reynisfjara-fjadrargljufur', '16021723026', '16022452871', []),
    ('iceland-drive-fjadrargljufur-skaftafell', '16022452871', '16023245494', []),
    ('iceland-drive-skaftafell-falljokull', '16023245494', '16034787340', []),
    ('iceland-drive-falljokull-mulagljufur', '16034787340', '16029608499', []),
    ('iceland-drive-mulagljufur-landeyjahofn', '16029608499', LANDEYJAHOFN, []),
    ('iceland-drive-landeyjahofn-kef', LANDEYJAHOFN, KEF, []),
]


def endpoint(spec, days, end):
    if isinstance(spec, dict):
        return {**spec, 'id': None}
    segments = days[spec]['segments']
    # Leaving a hike starts from its last fix; arriving meets its first fix.
    return {'name': HIKE_PLACES[spec], 'point': segments[-1][-1] if end == 'from' else segments[0][0], 'id': spec}


def build_routes(document, activities, cache):
    days = {d['id']: d for j in activities['journeys'] for d in j['days']}
    if not any(id in days for id in HIKE_PLACES):
        return document
    cache.mkdir(parents=True, exist_ok=True)
    # Replace the old Iceland drives in place; leave all other routes intact.
    old = lambda r: r['id'] == 'reykjavik-mulagljufur' or r['id'].startswith('iceland-drive-')
    position = next((i for i, r in enumerate(document['routes']) if old(r)), len(document['routes']))
    kept = [r for r in document['routes'] if not old(r)]
    position -= sum(1 for r in document['routes'][:position] if old(r))
    legs = [drive_leg(slug, endpoint(a, days, 'from'), endpoint(b, days, 'to'), via, cache)
            for slug, a, b, via in LEGS]
    document['routes'] = kept[:position] + legs + kept[position:]
    return document


def drive_leg(slug, origin, destination, via, cache):
    points = [origin['point'], *(p for _, p in via), destination['point']]
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
            'stops': [origin['name'], *(name for name, _ in via), destination['name']],
            'countries': ['352'], 'mode': 'Drive', 'operator': '',
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
    transport.write_text(json.dumps(document, separators=(',', ':'))+'\n')
