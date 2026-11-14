#!/usr/bin/env python3
"""Add one train, drive, bus, ferry or gondola route to the travel map.

Geometry comes from OpenStreetMap routers, matching the existing routes: BRouter's
rail profile for trains, OSRM driving for drives and buses, and a straight line for
ferries and gondolas (or any mode with --straight). Writes
assets/data/travel/transport.json; with --trip, also appends the route as a leg of
that trip's day in itineraries.json. Re-running with the same id replaces it.

    python -m scripts.travel.add_route --mode Train --operator "South Shore Line" --country 840 \\
        --stop "Chicago=41.88455,-87.62345" --stop "Dune Park=41.64496,-87.06057" --skip-if-overlap 0.3

Stops are "Name=lat,lon"; look coordinates up on openstreetmap.org (right-click → Show
address) or Nominatim. --via adds unnamed waypoints to steer the router.
"""

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from itertools import pairwise

from scripts.common.geo import distance_m
from scripts.travel.import_strava import simplify
from scripts.travel.trips import TRANSPORT, add_leg, country_ids, load, save, slugify

MODES = ["Train", "Drive", "Bus", "Ferry", "Gondola"]
USER_AGENT = "travel-map-importer"


def parse_point(text):
    lat, lon = (float(part) for part in text.split(","))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise SystemExit(f"Invalid coordinate {text!r}; expected lat,lon")
    return [lat, lon]


def parse_stop(text):
    name, _, coords = text.rpartition("=")
    if not name:
        raise SystemExit(f"Stop {text!r} must look like 'Name=lat,lon'")
    return name.strip(), parse_point(coords)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def brouter_rail(points):
    lonlats = "|".join(f"{lon},{lat}" for lat, lon in points)
    query = urllib.parse.urlencode({"lonlats": lonlats, "profile": "rail", "alternativeidx": 0, "format": "geojson"})
    data = fetch(f"https://brouter.de/brouter?{query}")
    return [[lat, lon] for lon, lat, *_ in data["features"][0]["geometry"]["coordinates"]], "BRouter rail"


def osrm_driving(points):
    path = ";".join(f"{lon},{lat}" for lat, lon in points)
    data = fetch(f"https://router.project-osrm.org/route/v1/driving/{path}?overview=full&geometries=geojson")
    if data.get("code") != "Ok":
        raise SystemExit(f"OSRM could not route: {data.get('message', data.get('code'))}")
    return [[lat, lon] for lon, lat in data["routes"][0]["geometry"]["coordinates"]], "OSRM driving"


def overlap_share(coords, other, within_m=150):
    """Share of `coords` (sampled every ~100 m) lying within `within_m` of the `other` line."""
    scale = math.cos(math.radians(coords[0][0]))

    def xy(point):
        return point[1] * 111195 * scale, point[0] * 111195

    lat_min, lat_max = min(p[0] for p in coords) - 0.05, max(p[0] for p in coords) + 0.05
    lon_min, lon_max = min(p[1] for p in coords) - 0.05, max(p[1] for p in coords) + 0.05
    nearby = [xy(p) for p in other if lat_min <= p[0] <= lat_max and lon_min <= p[1] <= lon_max]
    if len(nearby) < 2:
        return 0
    samples = []
    for a, b in pairwise(map(xy, coords)):
        steps = max(1, int(math.dist(a, b) // 100))
        samples += [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(steps)]

    def gap(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        span = dx * dx + dy * dy
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span)) if span else 0
        return math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])

    segments = list(pairwise(nearby))
    close = sum(any(gap(p, a, b) < within_m for a, b in segments) for p in samples)
    return close / max(len(samples), 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", required=True, choices=MODES)
    parser.add_argument("--stop", action="append", required=True, help="'Name=lat,lon'; at least two, in order")
    parser.add_argument("--via", action="append", default=[], help="Extra 'lat,lon' waypoint after the first stop")
    parser.add_argument("--country", action="append", required=True, help="Country name or ISO numeric ID; repeat")
    parser.add_argument("--id", help="Route id (defaults to '<first stop>-<last stop>[-<mode>]')")
    parser.add_argument("--name", help="Display name (defaults to 'First → Last')")
    parser.add_argument("--operator", default="")
    parser.add_argument("--note", help="Shown with the route, e.g. why it is approximate")
    parser.add_argument("--straight", action="store_true", help="Draw a straight line instead of routing")
    parser.add_argument("--trip", help="Also add the route as a leg of this itinerary trip")
    parser.add_argument("--trip-title", help="Title for the trip (required when the trip is new)")
    parser.add_argument("--date", help="Trip day, YYYY-MM-DD (defaults to the trip's last day)")
    parser.add_argument("--day-title", help="Title for the trip day")
    parser.add_argument("--leg-name", help="Leg label in the itinerary (defaults to the route name)")
    parser.add_argument("--new-day", action="store_true", help="Without --date, start a new trip day")
    parser.add_argument(
        "--skip-if-overlap",
        type=float,
        metavar="SHARE",
        help="Write nothing if this share (0-1) of the line already runs along an existing route, e.g. 0.3",
    )
    args = parser.parse_args()

    stops = [parse_stop(text) for text in args.stop]
    if len(stops) < 2:
        raise SystemExit("Give at least two --stop values")
    waypoints = [stops[0][1], *map(parse_point, args.via), *(coords for _, coords in stops[1:])]
    if args.straight or args.mode in ("Ferry", "Gondola"):
        coords, source = waypoints, "Straight line between stops"
    else:
        coords, source = brouter_rail(waypoints) if args.mode == "Train" else osrm_driving(waypoints)
        source += " · OpenStreetMap"
        time.sleep(1)
        for (name, stop), end in [(stops[0], coords[0]), (stops[-1], coords[-1])]:
            if distance_m(stop, end) > 1000:
                print(f"Warning: the routed line ends {distance_m(stop, end) / 1000:.1f} km from {name}")
    coords = simplify(coords, 3)
    names = [name for name, _ in stops]
    route_id = args.id or slugify(f"{names[0]}-{names[-1]}" + ("" if args.mode == "Train" else f"-{args.mode}"))
    route = {
        "id": route_id,
        "name": args.name or f"{names[0]} → {names[-1]}",
        "stops": names,
        "countries": country_ids(args.country),
        "mode": args.mode,
        "operator": args.operator,
        "coords": coords,
        "geometry_source": source,
    }
    if args.note:
        route["note"] = args.note

    document = load(TRANSPORT, {"routes": []})
    # Two lines drawn on top of each other look like a mistake on the map; report it.
    overlaps = sorted(
        ((overlap_share(coords, r["coords"]), r["id"]) for r in document["routes"] if r["id"] != route_id),
        reverse=True,
    )
    for share, other in overlaps:
        if share >= 0.1:
            print(f"Overlap: {share:.0%} of this line runs along existing route {other}")
    if args.skip_if_overlap is not None and overlaps and overlaps[0][0] >= args.skip_if_overlap:
        raise SystemExit(f"Not added: overlaps {overlaps[0][1]} more than {args.skip_if_overlap:.0%}")
    index = next((i for i, r in enumerate(document["routes"]) if r["id"] == route_id), None)
    if index is None:
        document["routes"].append(route)
    else:
        document["routes"][index] = route
    save(TRANSPORT, document)
    km = sum(distance_m(a, b) for a, b in zip(coords, coords[1:], strict=False)) / 1000
    print(f"{route_id}: {route['name']} · {args.mode} · {km:.1f} km · {len(coords)} points ({source})")
    if args.trip:
        leg = {"route": route_id}
        if args.leg_name:
            leg["name"] = args.leg_name
        add_leg(
            args.trip,
            leg,
            trip_title=args.trip_title,
            date=args.date,
            day_title=args.day_title,
            new_day=args.new_day,
        )


if __name__ == "__main__":
    main()
