"""Import flight-log CSV rows and bundle approximate airport connections."""
import argparse
import csv
import io
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def airport_code(label):
    match = re.search(r"\(([A-Z0-9]+)/([A-Z0-9]+)\)$", label)
    if not match:
        raise ValueError(f"Invalid airport: {label}")
    return match[1]


def great_circle(start, end):
    """Sample the shortest spherical arc and split it at the dateline."""
    def vector(point):
        lat, lon = map(math.radians, point)
        return (math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat))

    a, b = vector(start), vector(end)
    angle = math.acos(max(-1, min(1, sum(x*y for x, y in zip(a, b)))))
    steps = max(2, math.ceil(math.degrees(angle)))
    points = [start]
    for i in range(1, steps):
        t = i / steps
        if angle < 1e-8:
            point = start
        else:
            weights = (math.sin((1-t)*angle)/math.sin(angle), math.sin(t*angle)/math.sin(angle))
            x, y, z = (weights[0]*a[j]+weights[1]*b[j] for j in range(3))
            point = [math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))]
        points.append([round(value, 6) for value in point])
    points.append(end)
    segments = [[points[0]]]
    for point in points[1:]:
        previous = segments[-1][-1]
        if abs(point[1]-previous[1]) > 180:
            longitude = point[1] + (360 if point[1] < previous[1] else -360)
            edge = 180 if previous[1] > 0 else -180
            t = (edge-previous[1])/(longitude-previous[1])
            latitude = round(previous[0]+t*(point[0]-previous[0]), 6)
            segments[-1].append([latitude, edge])
            segments.append([[latitude, -edge]])
        segments[-1].append(point)
    return segments


def import_flights(path, airports):
    rows = csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig').lstrip()))
    flights = []
    connections = {}
    for row in rows:
        origin, destination = (airport_code(row[key]) for key in ('From', 'To'))
        if origin not in airports or destination not in airports:
            raise ValueError(f"Missing airport coordinates: {origin} → {destination}")
        hours, minutes, seconds = map(int, row['Duration'].split(':'))
        if hours < 0 or not 0 <= minutes < 60 or not 0 <= seconds < 60:
            raise ValueError(f"Invalid duration: {row['Duration']}")
        flight = {'number': row['Flight number'], 'from': origin, 'to': destination,
                  'duration_s': hours*3600+minutes*60+seconds}
        flights.append(flight)
        key = tuple(sorted((origin, destination)))
        connections.setdefault(key, []).append(len(flights)-1)
    routes = [{'airports': list(key), 'flights': indices,
               'segments': great_circle(airports[key[0]]['coords'], airports[key[1]]['coords'])}
              for key, indices in sorted(connections.items())]
    return {'geometry_source': 'Approximate great-circle connections; not recorded flight paths',
            'airports': airports, 'flights': flights, 'routes': routes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    args = parser.parse_args()
    airports = json.loads((ROOT/'data/flights.json').read_text())['airports']
    data = import_flights(args.csv, airports)
    (ROOT/'data/flights.json').write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False)+'\n')
    print(f"Saved {len(data['flights'])} flights on {len(data['routes'])} connections across {len(airports)} airports")


if __name__ == '__main__':
    main()
