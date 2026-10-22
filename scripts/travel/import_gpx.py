#!/usr/bin/env python3
"""Import actual GPX tracks into assets/data/travel/activities.json. No external dependencies."""

import argparse
import gzip
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

from scripts.common.geo import distance_m
from scripts.common.paths import TRAVEL_DATA


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def read_gpx(path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as source:
        root = ET.parse(source).getroot()
    segments = []
    times = []
    total_distance = 0
    total_ascent = 0
    has_elevation = False
    for track_segment in root.findall(".//{*}trkseg"):
        points = []
        previous_elevation = None
        for node in track_segment.findall("{*}trkpt"):
            point = [float(node.attrib["lat"]), float(node.attrib["lon"])]
            if not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180):
                raise ValueError(f"Invalid coordinate in {path.name}")
            if points:
                total_distance += distance_m(points[-1], point)
            points.append(point)
            elevation = node.findtext("{*}ele")
            if elevation is not None:
                elevation = float(elevation)
                has_elevation = True
                if previous_elevation is not None:
                    total_ascent += max(0, elevation - previous_elevation)
                previous_elevation = elevation
            else:
                previous_elevation = None
            timestamp = parse_time(node.findtext("{*}time"))
            if timestamp is not None:
                times.append(timestamp)
        if len(points) >= 2:
            segments.append(points)
    if not segments:
        raise ValueError(f"No track with at least two points in {path.name}")
    start = min(times) if times else parse_time(root.findtext("./{*}metadata/{*}time"))
    if start is None:
        raise ValueError(f"No activity date in {path.name}")
    item = {
        "id": path.name.removesuffix(".gz").removesuffix(".gpx"),
        "original_title": root.findtext("./{*}trk/{*}name"),
        "type": root.findtext("./{*}trk/{*}type"),
        "distance_m": round(total_distance, 1),
        "segments": [[[round(lat, 6), round(lon, 6)] for lat, lon in segment] for segment in segments],
        "source": {"file": path.name, "format": "GPX", "points": sum(map(len, segments))},
    }
    if times:
        item["elapsed_s"] = round((max(times) - min(times)).total_seconds())
    if has_elevation:
        item["elevation_m"] = round(total_ascent, 1)
    return item


def merge_days(existing, imported):
    by_id = {day["id"]: day for day in [*existing, *imported]}
    return list(by_id.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--journey", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--countries", required=True, help="Comma-separated ISO numeric country IDs, e.g. 250,380,756")
    parser.add_argument("--output", type=Path, default=TRAVEL_DATA / "activities.json")
    args = parser.parse_args()
    imported = [read_gpx(path) for path in args.files]
    if args.journey == "tmb":
        for day in imported:
            points = [point for segment in day["segments"] for point in segment]
            inside = sum(45.5 <= lat <= 46.3 and 6.3 <= lon <= 7.4 for lat, lon in points)
            if inside / len(points) < 0.8:
                raise ValueError(f"{day['source']['file']} is not a TMB-area activity")
    document = json.loads(args.output.read_text()) if args.output.exists() else {"journeys": []}
    journey = next((j for j in document["journeys"] if j["id"] == args.journey), None)
    if journey is None:
        journey = {"id": args.journey, "name": args.name, "countries": args.countries.split(","), "days": []}
        document["journeys"].append(journey)
    journey["days"] = merge_days(journey["days"], imported)
    for existing_journey in document["journeys"]:
        for day in existing_journey.get("days", []):
            day.pop("date", None)
            day.pop("started_at", None)
    args.output.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    for day in imported:
        print(f"{day['source']['file']}: {day['distance_m'] / 1000:.1f} km, {day['source']['points']} points")


if __name__ == "__main__":
    main()
