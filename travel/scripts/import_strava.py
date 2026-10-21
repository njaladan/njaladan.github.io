#!/usr/bin/env python3
"""Import a reviewed selection from a local Strava export (FIT needs fitdecode)."""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import gzip
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from import_gpx import distance, read_gpx

COUNTRIES = {
    'United Kingdom': ('826', 'united-kingdom'), 'France': ('250', 'france'),
    'Norway': ('578', 'norway'), 'Netherlands': ('528', 'netherlands'),
    'Switzerland': ('756', 'switzerland'), 'Italy': ('380', 'italy'),
    'Morocco': ('504', 'morocco'), 'Spain': ('724', 'spain'),
    'Canada': ('124', 'canada'), 'Hong Kong S.A.R.': ('156', 'hong-kong'),
    'Iceland': ('352', 'iceland'), 'Turkey': ('792', 'turkey'),
    'Chile': ('152', 'chile'),
}
TYPES = {'Hike': 'hiking', 'Walk': 'walking', 'Ride': 'cycling',
         'E-Bike Ride': 'cycling', 'Run': 'running'}


def simplify(points, tolerance=3):
    """Douglas–Peucker in meters, preserving each recorded segment's endpoints."""
    if len(points) < 3:
        return points
    scale = math.cos(math.radians(sum(p[0] for p in points) / len(points)))
    xy = [(p[1] * 111195 * scale, p[0] * 111195) for p in points]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        a, b = xy[first], xy[last]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dy * dy
        maximum, selected = tolerance * tolerance, None
        for index in range(first + 1, last):
            p = xy[index]
            t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
            squared = (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2
            if squared > maximum:
                maximum, selected = squared, index
        if selected is not None:
            keep.add(selected)
            stack.extend([(first, selected), (selected, last)])
    return [[round(v, 6) for v in points[i]] for i in sorted(keep)]


def read_fit(path, activity_start, elapsed_s):
    try:
        import fitdecode
    except ImportError as exc:
        raise SystemExit('FIT import needs fitdecode: python -m pip install fitdecode') from exc
    segments, points, times = [], [], []
    previous_time = None
    opener = gzip.open if path.suffix == '.gz' else open
    activity_end = activity_start + timedelta(seconds=elapsed_s)
    with opener(path, 'rb') as source, fitdecode.FitReader(source) as reader:
        for frame in reader:
            if not isinstance(frame, fitdecode.FitDataMessage) or frame.name != 'record':
                continue
            lat = frame.get_value('position_lat', fallback=None)
            lon = frame.get_value('position_long', fallback=None)
            if lat is None or lon is None:
                continue
            point = [lat * 180 / 2**31, lon * 180 / 2**31]
            if not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180) or point == [0, 0]:
                continue
            timestamp = frame.get_value('timestamp', fallback=None)
            # Strava crops leave the original, longer FIT file in the export.
            # Respect the CSV's published interval instead of importing later driving.
            if not timestamp or timestamp < activity_start or timestamp > activity_end:
                continue
            # A long GPS gap must not turn into an invented connecting line.
            if points and timestamp and previous_time and (timestamp-previous_time).total_seconds() > 120 and distance(points[-1], point) > 200:
                if len(points) >= 2:
                    segments.append(points)
                points = []
            points.append(point)
            if timestamp:
                times.append(timestamp)
                previous_time = timestamp
    if len(points) >= 2:
        segments.append(points)
    if not segments or not times:
        raise ValueError(f'No dated GPS track in {path.name}')
    return {'segments': segments, 'started_at': activity_start.isoformat(),
            'source': {'file': path.name, 'format': 'FIT', 'points': sum(map(len, segments))}}


def read_tcx(path):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as source:
        root = ET.fromstring(source.read().lstrip())
    segments, times = [], []
    for track in root.findall('.//{*}Track'):
        points = []
        for node in track.findall('{*}Trackpoint'):
            pos = node.find('{*}Position')
            if pos is not None:
                points.append([float(pos.findtext('{*}LatitudeDegrees')), float(pos.findtext('{*}LongitudeDegrees'))])
            value = node.findtext('{*}Time')
            if value:
                times.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
        if len(points) >= 2:
            segments.append(points)
    if not segments or not times:
        raise ValueError(f'No dated GPS track in {path.name}')
    return {'segments': segments, 'started_at': min(times).isoformat(),
            'source': {'file': path.name, 'format': 'TCX', 'points': sum(map(len, segments))}}


def import_selection(export, review, output, replace=False):
    selected = json.loads(review.read_text())
    rows = {row['Activity ID']: row for row in csv.DictReader((export/'activities.csv').open())}
    document = json.loads(output.read_text()) if output.exists() else {'journeys': []}
    existing = {day['id'] for journey in document['journeys'] for day in journey['days']}
    added = 0
    for entry in selected:
        activity_id = entry['Activity ID']
        if activity_id in existing and (not replace or entry.get('already_imported')):
            continue
        row = rows[activity_id]
        if row['Filename'] != entry['Filename']:
            raise ValueError(f'Export filename changed for activity {activity_id}')
        path = export / row['Filename']
        activity_start = datetime.strptime(row['Activity Date'], '%b %d, %Y, %I:%M:%S %p').replace(tzinfo=timezone.utc)
        if '.gpx' in path.suffixes:
            day = read_gpx(path)
        elif '.fit' in path.suffixes:
            day = read_fit(path, activity_start, float(row['Elapsed Time']))
        elif '.tcx' in path.suffixes:
            day = read_tcx(path)
        else:
            raise ValueError(f'Unsupported track format: {path.name}')
        day.update(id=activity_id, name=row['Activity Name'],
                   original_title=row['Activity Name'], type=TYPES[row['Activity Type']],
                   sport=row['Activity Type'])
        for field, column in [('distance_m', 'Distance'), ('elapsed_s', 'Elapsed Time'), ('elevation_m', 'Elevation Gain')]:
            if row[column]:
                day[field] = round(float(row[column]), 1)
        # Recorded statistics come from the export; lightweight geometry is for display.
        day['source'].update(statistics='Strava CSV', simplification_m=3)
        day['segments'] = [simplify(segment) for segment in day['segments']]
        day['source']['display_points'] = sum(map(len, day['segments']))
        countries = [COUNTRIES[name][0] for name in entry['countries']]
        is_tmb = row['Activity Name'].startswith('mon blanc day')
        slug = 'tmb' if is_tmb else COUNTRIES[entry['countries'][0]][1] + '-activities'
        name = 'Tour du Mont Blanc' if is_tmb else entry['countries'][0].replace('Hong Kong S.A.R.', 'Hong Kong SAR') + ' activities'
        if is_tmb:
            countries = ['250', '380', '756']
            day['name'] = row['Activity Name'].replace('mon blanc day', 'TMB · Day', 1)
        day['countries'] = [COUNTRIES[name][0] for name in entry['countries']]
        if replace:
            for previous in document['journeys']:
                previous['days'] = [d for d in previous['days'] if d['id'] != activity_id]
        journey = next((j for j in document['journeys'] if j['id'] == slug), None)
        if journey is None:
            journey = {'id': slug, 'name': name, 'countries': countries, 'days': []}
            document['journeys'].append(journey)
        journey['countries'] = list(dict.fromkeys([*journey['countries'], *countries]))
        journey['days'].append(day)
        journey['days'].sort(key=lambda d: d.get('started_at', ''))
        existing.add(activity_id)
        added += 1
        print(f"{activity_id}: {day['name']} · {day['source']['display_points']} display points", flush=True)
    for journey in document['journeys']:
        for day in journey.get('days', []):
            day.pop('date', None)
            day.pop('started_at', None)
    output.write_text(json.dumps(document, separators=(',', ':'), ensure_ascii=False)+'\n')
    print(f'Added {added}; total {len(existing)} activities', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path)
    parser.add_argument('review', type=Path, help='User-reviewed activity manifest')
    parser.add_argument('--output', type=Path, default=Path(__file__).parents[1]/'data/activities.json')
    parser.add_argument('--replace', action='store_true', help='Reimport new reviewed tracks, preserving tracks present before this review')
    args = parser.parse_args()
    import_selection(args.export, args.review, args.output, args.replace)
