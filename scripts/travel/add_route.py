#!/usr/bin/env python3
"""Add one train, drive, bus, ferry or gondola route to the travel map.

Geometry comes from OpenStreetMap routers, matching the existing routes: BRouter's
rail profile for trains, OSRM driving for drives and buses, and a straight line for
ferries and gondolas (or any mode with --straight). Writes
assets/data/travel/transport.json; with --trip, also appends the route as a leg of
that trip's day in itineraries.json. Re-running with the same id replaces it.

    python -m scripts.travel.add_route --mode Train --operator "South Shore Line" --country 840 \\
        --stop "Chicago=41.88455,-87.62345" --stop "Dune Park=41.64496,-87.06057" \\
        --trip indiana-dunes --trip-title "Indiana Dunes National Park" --date 2026-11-14

Stops are "Name=lat,lon"; look coordinates up on openstreetmap.org (right-click → Show
address) or Nominatim. --via adds unnamed waypoints to steer the router.
"""

import argparse
import json
import time
import urllib.parse
import urllib.request

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
