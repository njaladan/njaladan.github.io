#!/usr/bin/env python3
"""Compact Natural Earth context into one local, preloadable map file."""
import argparse
import json
from pathlib import Path


def simplify(points, tolerance):
    if len(points) <= 2:
        return points
    first, last = points[0], points[-1]
    dx, dy = last[0]-first[0], last[1]-first[1]
    denominator = dx*dx+dy*dy
    furthest = 0
    index = 0
    for i, point in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((point[0]-first[0])*dx+(point[1]-first[1])*dy)/denominator)) if denominator else 0
        distance = (point[0]-first[0]-t*dx)**2+(point[1]-first[1]-t*dy)**2
        if distance > furthest:
            furthest, index = distance, i
    if furthest > tolerance*tolerance:
        return simplify(points[:index+1], tolerance)[:-1]+simplify(points[index:], tolerance)
    return [first, last]


def line_parts(geometry):
    return [geometry['coordinates']] if geometry['type']=='LineString' else geometry['coordinates']


def rounded(points):
    return [[round(x, 4), round(y, 4)] for x, y, *_ in points]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).parents[1]/'data/context.json')
    args=parser.parse_args()
    def read(name):
        return json.loads((args.source/(name+'.geojson')).read_text())['features']
    roads=[]
    regions=[(-170,10,-50,82),(-76,-56,-66,-17),(-25,34,41,72),(-18,20,40,38),(67,5,99,38),(127,24,146,46),(113.7,22.1,114.6,22.7)]
    for feature in read('ne_10m_roads'):
        p=feature['properties']
        if p['type'] not in ['Major Highway','Beltway','Bypass'] and p['scalerank']>5:
            continue
        if p['type'].startswith('Ferry'):
            continue
        for part in line_parts(feature['geometry']):
            xs=[point[0] for point in part];ys=[point[1] for point in part]
            if not any(min(xs)<=east and max(xs)>=west and min(ys)<=north and max(ys)>=south for west,south,east,north in regions):
                continue
            roads.append(rounded(simplify(part, .006)))
    rivers=[]
    for feature in read('ne_50m_rivers_lake_centerlines'):
        for part in line_parts(feature['geometry']):
            rivers.append(rounded(simplify(part, .005)))
    lakes=[]
    for feature in read('ne_50m_lakes'):
        g=feature['geometry']
        polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
        for polygon in polygons:
            rings=[]
            for ring in polygon:
                reduced=rounded(simplify(ring, .003))
                if len(reduced)<4:
                    reduced=rounded(ring)
                rings.append(reduced)
            lakes.append(rings)
    cities=[]
    for feature in read('ne_50m_populated_places'):
        p=feature['properties']
        if p['POP_MAX']<300000 and not p['ADM0CAP']:
            continue
        cities.append({'name':p['NAME_EN'] or p['NAME'],'coords':[round(p['LATITUDE'],4),round(p['LONGITUDE'],4)],'rank':p['SCALERANK']})
    document={'roads':roads,'rivers':rivers,'lakes':lakes,'cities':cities}
    args.output.write_text(json.dumps(document,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'bytes':args.output.stat().st_size,'roads':len(roads),'rivers':len(rivers),'lakes':len(lakes),'major_cities':len(cities)}))


if __name__=='__main__':
    main()
