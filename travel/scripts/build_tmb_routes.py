#!/usr/bin/env python3
"""Save the Tour du Mont Blanc bus, rack-railway and gondola links between recorded hiking days.

Bus legs are OSRM road paths anchored on the recorded Strava track ends, so they meet the
trails. The Montenvers rack railway follows BRouter's rail profile over the OSM line, and the
Mer de Glace gondola is the OSM aerialway itself (fetched once from the OSM API and cached).
Existing records keep their place in transport.json; new ones are appended.
"""
import argparse
import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from build_transport_routes import ROOT, meters, routed, simplify

DAY2, DAY3, DAY4 = '19741275168', '19756109637', '19770669684'
CHAPIEUX = [45.6966794, 6.7335808]          # OSM place=hamlet Les Chapieux
BOURG = [45.6188325, 6.7713438]             # Gare de Bourg-Saint-Maurice
CHAMONIX_MONTENVERS = [45.9225675, 6.8751072]  # OSM station way 97313379
MONTENVERS = [45.9317275, 6.9174169]        # OSM station node 283313364
MER_DE_GLACE_GONDOLA_WAY = 1183440386       # aerialway=gondola "TC Mer de Glace"


def track_point(days, day, which, segment=None):
    segments = days[day]['segments']
    if which == 'start':
        return segments[segment or 0][0]
    return segments[-1 if segment is None else segment][-1]


def bus(id, name, stops, countries, points, departure, arrival, note):
    return {'id': id, 'name': name, 'stops': stops, 'countries': countries, 'mode': 'Bus',
            'operator': '', 'points': points, 'note': note,
            'bus': {'tags': ['Local bus', 'One way'], 'departure_stop': departure, 'arrival_stop': arrival}}


def trips(days):
    return [
        bus('tmb-chapieux-bourg-bus', 'La Ville des Glaciers → Bourg-Saint-Maurice',
            ['La Ville des Glaciers', 'Les Chapieux', 'Bourg-Saint-Maurice'], ['250'],
            [track_point(days, DAY2, 'end'), CHAPIEUX, BOURG],
            'La Ville des Glaciers', 'Bourg-Saint-Maurice',
            'Bus down the Vallée des Chapieux at the end of TMB Day 2; road path estimated from the recorded track end.'),
        bus('tmb-bourg-chapieux-bus', 'Bourg-Saint-Maurice → La Ville des Glaciers',
            ['Bourg-Saint-Maurice', 'Les Chapieux', 'La Ville des Glaciers'], ['250'],
            [BOURG, CHAPIEUX, track_point(days, DAY3, 'start')],
            'Bourg-Saint-Maurice', 'La Ville des Glaciers',
            'Bus back up to the trail before TMB Day 3; road path estimated to the recorded track start.'),
        bus('tmb-day4-courmayeur-bus', 'Rifugio Monte Bianco → Courmayeur',
            ['Rifugio Monte Bianco', 'Courmayeur'], ['380'],
            [track_point(days, DAY3, 'end'), track_point(days, DAY4, 'start', 1)],
            'Rifugio Monte Bianco (Val Veny)', 'Courmayeur',
            'Bus down Val Veny to Courmayeur before the Day 4 hike; road path estimated between the recorded track ends.'),
        {'id': 'chamonix-montenvers-train', 'name': 'Chamonix → Montenvers',
         'stops': ['Chamonix', 'Montenvers'], 'countries': ['250'], 'mode': 'Train',
         'operator': 'Train du Montenvers', 'points': [CHAMONIX_MONTENVERS, MONTENVERS]},
    ]


def osm_way(way_id, cache):
    path = cache/f'osm-way-{way_id}.xml'
    if not path.exists():
        url = f'https://api.openstreetmap.org/api/0.6/way/{way_id}/full'
        request = urllib.request.Request(url, headers={'User-Agent': 'njaladan-travel-map/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response:
            path.write_bytes(response.read())
    root = ET.fromstring(path.read_bytes())
    nodes = {n.get('id'): [round(float(n.get('lat')), 7), round(float(n.get('lon')), 7)] for n in root.iter('node')}
    way = next(root.iter('way'))
    return [nodes[nd.get('ref')] for nd in way.iter('nd')]


def build(document, activities, cache):
    days = {d['id']: d for j in activities['journeys'] for d in j['days']}
    built = []
    for trip in trips(days):
        points = trip.pop('points')
        coords = routed(points, trip['mode'], cache, trip['id'])
        if meters(coords[0], points[0]) > meters(coords[-1], points[0]):
            coords.reverse()
        offsets = [meters(coords[0], points[0]), meters(coords[-1], points[-1])]
        if max(offsets) > 300:
            raise ValueError(f"{trip['id']}: path ends {max(offsets):.0f} m from its stop")
        for stop, point in zip(trip['stops'], points):
            if min(meters(point, c) for c in coords) > 300:
                raise ValueError(f"{trip['id']}: path misses {stop}")
        coords = simplify(coords)
        if trip['mode'] == 'Bus':
            # Short connectors meet the recorded GPS track ends exactly.
            coords = [[round(v, 6) for v in p] for p in (points[0], *coords, points[-1])]
            coords = [p for i, p in enumerate(coords) if not i or p != coords[i-1]]
        trip['coords'] = coords
        trip['geometry_source'] = 'BRouter rail · OpenStreetMap' if trip['mode'] == 'Train' else 'OSRM driving · OpenStreetMap'
        built.append(trip)
    gondola = osm_way(MER_DE_GLACE_GONDOLA_WAY, cache)
    if meters(gondola[0], MONTENVERS) > meters(gondola[-1], MONTENVERS):
        gondola.reverse()
    built.append({'id': 'montenvers-mer-de-glace-gondola', 'name': 'Montenvers → Mer de Glace',
                  'stops': ['Montenvers', 'Mer de Glace ice cave'], 'countries': ['250'], 'mode': 'Gondola',
                  'operator': 'Télécabine du Glacier · Compagnie du Mont-Blanc', 'coords': gondola,
                  'geometry_source': f'OpenStreetMap aerialway {MER_DE_GLACE_GONDOLA_WAY}'})
    for trip in built:
        km = sum(meters(a, b) for a, b in zip(trip['coords'], trip['coords'][1:])) / 1000
        print(f"{trip['id']}: {trip['mode']}, {len(trip['coords'])} vertices, {km:.1f} km", flush=True)
    fresh = {trip['id']: trip for trip in built}
    document['routes'] = [fresh.pop(r['id'], r) for r in document['routes']] + list(fresh.values())
    return document


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    transport = ROOT/'data/transport.json'
    document = build(json.loads(transport.read_text()), json.loads((ROOT/'data/activities.json').read_text()), args.cache)
    transport.write_text(json.dumps(document, separators=(',', ':'))+'\n')
