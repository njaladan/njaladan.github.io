#!/usr/bin/env python3
"""Package high-level Natural Earth city labels for the neutral atlas basemap."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).parents[1] / 'data/context.json')
    args = parser.parse_args()
    features = json.loads((args.source / 'ne_50m_populated_places.geojson').read_text())['features']
    cities = []
    for feature in features:
        props = feature['properties']
        if props['SCALERANK'] > 2 or props['POP_MAX'] < 300000 and not props['ADM0CAP']:
            continue
        cities.append({
            'name': props['NAME_EN'] or props['NAME'],
            'coords': [round(props['LATITUDE'], 4), round(props['LONGITUDE'], 4)],
            'rank': props['SCALERANK'],
        })
    cities.sort(key=lambda city: (city['rank'], city['name']))
    args.output.write_text(json.dumps({'cities': cities}, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'bytes': args.output.stat().st_size, 'major_cities': len(cities)}))


if __name__ == '__main__':
    main()
