#!/usr/bin/env python3
"""Add one watch FIT file (Garmin, Coros, ...) to the travel map, optionally as a trip day.

Reads the track and recorded statistics straight from the FIT file (no Strava export
needed). A GPX file from a Strava export works too; its distance, time and climb are
worked out from the track, and its times are UTC unless --utc-offset says otherwise.
The track is thinned, snapped onto OpenStreetMap paths with Valhalla, and written to
assets/data/travel/activities.json. With --trip it also appends the activity as a leg
of that trip's day in itineraries.json. Re-running replaces the earlier import.

    python -m scripts.travel.add_fit hike.fit --name "Indiana Dunes" --country "United States"
"""

import argparse
import gzip
import xml.etree.ElementTree as ET
from datetime import timedelta
from pathlib import Path

from scripts.common.geo import distance_m
from scripts.travel.import_gpx import parse_time
from scripts.travel.import_strava import simplify
from scripts.travel.match_activities import PROFILES, length, match_segment, tidy
from scripts.travel.trips import ACTIVITIES, COUNTRIES, add_leg, country_ids, load, save

# FIT sport → (map activity type, Strava-style sport label).
SPORTS = {
    "hiking": ("hiking", "Hike"),
    "walking": ("walking", "Walk"),
    "running": ("running", "Run"),
    "cycling": ("cycling", "Ride"),
    "e_biking": ("cycling", "E-Bike Ride"),
}
SEMICIRCLE = 180 / 2**31
GAP_S, GAP_M = 120, 200
# GPX tracks carry no recorded totals, and one-second GPS jitter inflates both. Distance
# is measured on the track thinned to this spacing; elevation is averaged over this many
# seconds either side, then only rises of at least CLIMB_STEP_M count as climb.
DISTANCE_SPACING_M = 12
ELEVATION_WINDOW_S = 30
CLIMB_STEP_M = 4


def read_fit(path):
    try:
        import fitdecode
    except ImportError as exc:
        raise SystemExit("FIT import needs fitdecode: python -m pip install fitdecode") from exc
    segments, points = [], []
    session, offset, previous_time = {}, None, None
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as source, fitdecode.FitReader(source) as reader:
        for frame in reader:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            if frame.name == "session" and not session:
                session = {field.name: field.value for field in frame.fields if field.value is not None}
            elif frame.name == "activity":
                local, utc = (frame.get_value(k, fallback=None) for k in ("local_timestamp", "timestamp"))
                if local and utc:
                    offset = local.replace(tzinfo=None) - utc.replace(tzinfo=None)
            elif frame.name == "record":
                lat = frame.get_value("position_lat", fallback=None)
                lon = frame.get_value("position_long", fallback=None)
                timestamp = frame.get_value("timestamp", fallback=None)
                if lat is None or lon is None:
                    continue
                point = [lat * SEMICIRCLE, lon * SEMICIRCLE]
                if not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180) or point == [0, 0]:
                    continue
                # A long GPS gap (watch paused, tunnel) must not become an invented straight line.
                if (
                    points
                    and timestamp
                    and previous_time
                    and (timestamp - previous_time).total_seconds() > GAP_S
                    and distance_m(points[-1], point) > GAP_M
                ):
                    if len(points) >= 2:
                        segments.append(points)
                    points = []
                points.append(point)
                previous_time = timestamp or previous_time
    if len(points) >= 2:
        segments.append(points)
    if not segments:
        raise SystemExit(f"No GPS track in {path.name}")
    if "start_time" not in session:
        raise SystemExit(f"No session summary in {path.name}")
    return segments, session, offset or timedelta()


def climb(samples):
    """Total ascent from (time, elevation) samples, smoothed against GPS noise."""
    smoothed, start, end, running = [], 0, 0, 0.0
    for when, _ in samples:
        while end < len(samples) and (samples[end][0] - when).total_seconds() <= ELEVATION_WINDOW_S:
            running += samples[end][1]
            end += 1
        while (when - samples[start][0]).total_seconds() > ELEVATION_WINDOW_S:
            running -= samples[start][1]
            start += 1
        smoothed.append(running / (end - start))
    total, low = 0.0, None
    for value in smoothed:
        if low is None or value < low:
            low = value
        elif value - low >= CLIMB_STEP_M:
            total += value - low
            low = value
    return total


def read_gpx(path):
    """A Strava-export GPX track in the same shape as read_fit's result."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as source:
        root = ET.parse(source).getroot()
    segments, elevations, times = [], [], []
    for track_segment in root.findall(".//{*}trkseg"):
        points, previous_time = [], None
        for node in track_segment.findall("{*}trkpt"):
            point = [float(node.attrib["lat"]), float(node.attrib["lon"])]
            timestamp = parse_time(node.findtext("{*}time"))
            if (
                points
                and timestamp
                and previous_time
                and (timestamp - previous_time).total_seconds() > GAP_S
                and distance_m(points[-1], point) > GAP_M
            ):
                if len(points) >= 2:
                    segments.append(points)
                points = []
            points.append(point)
            elevation = node.findtext("{*}ele")
            if elevation is not None and timestamp:
                elevations.append((timestamp, float(elevation)))
            if timestamp:
                times.append(timestamp)
                previous_time = timestamp
        if len(points) >= 2:
            segments.append(points)
    if not segments or not times:
        raise SystemExit(f"No dated GPS track in {path.name}")
    session = {
        "start_time": min(times),
        "sport": (root.findtext("./{*}trk/{*}type") or "").strip(),
        "total_distance": sum(length(tidy(segment, DISTANCE_SPACING_M)) for segment in segments),
        "total_elapsed_time": (max(times) - min(times)).total_seconds(),
        "title": (root.findtext("./{*}trk/{*}name") or "").strip(),
    }
    if elevations:
        session["total_ascent"] = round(climb(elevations))
    return segments, session


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path, help="FIT or Strava-export GPX file (.fit, .gpx, optionally .gz)")
    parser.add_argument("--name", required=True, help="Display name on the map, e.g. 'Indiana Dunes'")
    parser.add_argument("--title", help="Original activity title (defaults to the GPX track name, else --name)")
    parser.add_argument("--country", action="append", required=True, help="Country name or ISO numeric ID; repeat")
    parser.add_argument("--id", help="Activity id (defaults to fit-<UTC start>, or pass the Strava/Garmin id)")
    parser.add_argument("--type", choices=sorted(PROFILES), help="Override the sport read from the file")
    parser.add_argument("--journey", help="Journey id (defaults to '<country>-activities')")
    parser.add_argument("--journey-name", help="Journey name when creating a new journey")
    parser.add_argument("--trip", help="Also add the activity as a leg of this itinerary trip")
    parser.add_argument("--trip-title", help="Title for the trip (required when the trip is new)")
    parser.add_argument("--day-title", help="Title for the trip day (defaults to --name for a new day)")
    parser.add_argument("--leg-name", help="Leg label in the itinerary (defaults to --name)")
    parser.add_argument("--no-match", action="store_true", help="Keep the GPS line; skip Valhalla map matching")
    parser.add_argument("--utc-offset", type=float, help="GPX only: local time minus UTC in hours (e.g. -7)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/travel-valhalla")
    args = parser.parse_args()

    if ".gpx" in args.file.suffixes:
        segments, session = read_gpx(args.file)
        offset = timedelta(hours=args.utc_offset or 0)
        source_format, statistics = "GPX", "GPX track"
    else:
        segments, session, offset = read_fit(args.file)
        source_format, statistics = "FIT", "FIT session"
    start = session["start_time"]
    local_date = (start.replace(tzinfo=None) + offset).date().isoformat()
    sport = str(session.get("sport", ""))
    activity_type, sport_label = SPORTS.get(sport, ("walking", "Walk"))
    if args.type:
        activity_type = args.type
        sport_label = next((label for t, label in SPORTS.values() if t == args.type), sport_label)
    countries = country_ids(args.country)
    activity_id = args.id or "fit-" + start.strftime("%Y%m%dT%H%M%SZ")

    raw_points = sum(map(len, segments))
    day = {
        "id": activity_id,
        "name": args.name,
        "original_title": args.title or session.get("title") or args.name,
        "type": activity_type,
        "sport": sport_label,
        "countries": countries,
    }
    for field, key in [("distance_m", "total_distance"), ("elapsed_s", "total_elapsed_time")]:
        if key in session:
            day[field] = round(float(session[key]), 1)
    if "total_ascent" in session:
        day["elevation_m"] = float(session["total_ascent"])
    source = {
        "file": args.file.name,
        "format": source_format,
        "points": raw_points,
        "statistics": statistics,
        "simplification_m": 3,
    }
    if args.no_match:
        segments = [simplify(segment) for segment in segments]
    else:
        args.cache.mkdir(parents=True, exist_ok=True)
        profile = PROFILES[activity_type]
        matched, total, snapped = [], 0, 0
        for segment in segments:
            coords, on_path, size = match_segment(segment, profile, args.cache)
            if len(coords) >= 2:
                matched.append(coords)
            snapped, total = snapped + on_path, total + size
        segments = matched
        source.update(matched=f"Valhalla {profile} · OpenStreetMap", matched_share=round(snapped / max(total, 1), 2))
    source["display_points"] = sum(map(len, segments))
    day["segments"] = segments
    day["source"] = source

    document = load(ACTIVITIES, {"journeys": []})
    for journey in document["journeys"]:
        journey["days"] = [d for d in journey["days"] if d["id"] != activity_id]
    first_country = next((name for name, (code, _) in COUNTRIES.items() if code == countries[0]), None)
    journey_id = args.journey or (COUNTRIES[first_country][1] if first_country else countries[0]) + "-activities"
    journey = next((j for j in document["journeys"] if j["id"] == journey_id), None)
    if journey is None:
        name = args.journey_name or f"{first_country or countries[0]} activities".replace("S.A.R.", "SAR")
        journey = {"id": journey_id, "name": name, "countries": countries, "days": []}
        document["journeys"].append(journey)
    journey["countries"] = list(dict.fromkeys([*journey["countries"], *countries]))
    journey["days"].append(day)
    save(ACTIVITIES, document)

    print(
        f"{activity_id} → {journey_id}: {args.name}, {local_date}, {activity_type}, "
        f"{day.get('distance_m', 0) / 1000:.1f} km, {day.get('elevation_m', 0):.0f} m up, "
        f"{raw_points} → {source['display_points']} points"
        + (f", {source['matched_share']:.0%} on mapped paths" if "matched_share" in source else "")
    )
    if args.trip:
        leg = {"activity": activity_id, "name": args.leg_name or args.name}
        add_leg(
            args.trip,
            leg,
            trip_title=args.trip_title,
            date=local_date,
            day_title=args.day_title,
            hiking=activity_type in ("hiking", "running"),
        )


if __name__ == "__main__":
    main()
