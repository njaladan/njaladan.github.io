#!/usr/bin/env python3
"""Merge confirmed ferry crossings into the bundled transport paths, without routing them on roads."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def merge_ferries(document, ferries):
    ids = {route['id'] for route in ferries['routes']}
    for route in ferries['routes']:
        route['dates'] = []
    document['routes'] = [route for route in document['routes'] if route['id'] not in ids] + ferries['routes']
    for route in document['routes']:
        route['dates'] = []
    return document


if __name__ == '__main__':
    transport = ROOT/'data/transport.json'
    document = merge_ferries(json.loads(transport.read_text()), json.loads((ROOT/'data/ferries.json').read_text()))
    transport.write_text(json.dumps(document, separators=(',', ':'), ensure_ascii=False)+'\n')
    print(f"Saved {len(document['routes'])} transport paths, including {sum(r['mode']=='Ferry' for r in document['routes'])} ferry paths")
