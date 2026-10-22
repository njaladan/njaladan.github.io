#!/usr/bin/env python3
"""Snap recorded walks, hikes and rides onto OpenStreetMap paths for display.

GPS jitter (stops, narrow streets, spikes) is thinned first, then each track is
map-matched with Valhalla's pedestrian or bicycle costing. Stretches with no mapped
path, or only brief matches, keep the GPS line with its corners rounded off.
Recorded statistics are left untouched.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request

from import_gpx import distance
from import_strava import simplify

PROFILES = {"walking": "pedestrian", "hiking": "pedestrian", "running": "pedestrian", "cycling": "bicycle"}
SPACING_M = {"pedestrian": 12, "bicycle": 20}
RADIUS_M = {"pedestrian": 20, "bicycle": 25}
# Alpine routes (TMB, W Trek) are tagged above Valhalla's default hiking difficulty.
COSTING = {"pedestrian": {"max_hiking_difficulty": 6}, "bicycle": {}}
CHUNK = 500
MIN_RUN = 4


def length(points):
    return sum(distance(a, b) for a, b in zip(points, points[1:]))


def tidy(points, spacing):
    """Collapse stationary clusters and drop short out-and-back GPS spikes."""
    if len(points) < 3:
        return points
    thinned = [points[0]]
    for point in points[1:-1]:
        if distance(thinned[-1], point) >= spacing:
            thinned.append(point)
    if len(thinned) > 1 and distance(thinned[-1], points[-1]) < spacing:
        thinned.pop()
    thinned.append(points[-1])
    kept = [thinned[0]]
    for a, b, c in zip(thinned, thinned[1:], thinned[2:]):
        # An isolated jump out and straight back; judged against original neighbours so
        # genuine out-and-back walks are not eaten one point at a time.
        near = min(distance(a, b), distance(b, c))
        if 25 < near and max(distance(a, b), distance(b, c)) < 150 and distance(a, c) < near / 2:
            continue
        kept.append(b)
    kept.append(thinned[-1])
    return kept


def decode(encoded):
    """Valhalla shapes are polylines with six decimal places."""
    coords, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        values = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat, lon = lat + values[0], lon + values[1]
        coords.append([lat / 1e6, lon / 1e6])
    return coords


def request(points, profile, cache):
    body = json.dumps(
        {
            "shape": [{"lat": lat, "lon": lon} for lat, lon in points],
            "costing": profile,
            "costing_options": {profile: COSTING[profile]},
            "shape_match": "map_snap",
            "trace_options": {"search_radius": RADIUS_M[profile]},
            "filters": {
                "attributes": [
                    "shape",
                    "edge.begin_shape_index",
                    "edge.end_shape_index",
                    "matched.type",
                    "matched.point",
                    "matched.edge_index",
                ],
                "action": "include",
            },
        },
        sort_keys=True,
    ).encode()
    path = cache / (hashlib.sha1(body).hexdigest()[:20] + ".json")
    if not path.exists():
        request = urllib.request.Request(
            "https://valhalla1.openstreetmap.de/trace_attributes", body, {"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=100) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raw = error.read()
        path.write_bytes(raw)
        time.sleep(1)
    return json.loads(path.read_text())


def chaikin(points, rounds=2):
    """Round off corners of the unmatched GPS line, keeping its endpoints."""
    for _ in range(rounds):
        if len(points) < 3:
            break
        rounded = [points[0]]
        for a, b in zip(points, points[1:]):
            rounded += [
                [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
                [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
            ]
        points = [*rounded[:-1], points[-1]]
    return points


def locate(shape, first, last, point):
    """Fractional shape index of a snapped point on its edge's vertices."""
    scale = math.cos(math.radians(point[0]))
    best = (math.inf, first)
    for k in range(first, max(first + 1, last)):
        a, b = shape[k], shape[min(k + 1, len(shape) - 1)]
        dx, dy = (b[1] - a[1]) * scale, b[0] - a[0]
        span = dx * dx + dy * dy
        t = max(0, min(1, ((point[1] - a[1]) * scale * dx + (point[0] - a[0]) * dy) / span)) if span else 0
        gap = ((a[1] + t * (b[1] - a[1]) - point[1]) * scale) ** 2 + (a[0] + t * (b[0] - a[0]) - point[0]) ** 2
        best = min(best, (gap, k + t))
    return best[1]


def match_chunk(points, profile, cache):
    """Return ordered (snapped, points) pieces; consecutive pieces share endpoints."""
    data = request(points, profile, cache)
    if "shape" not in data:
        return [(False, points)]
    shape, edges = decode(data["shape"]), data["edges"]
    anchors = []
    for index, point in enumerate(data["matched_points"]):
        if point["type"] == "matched" and point.get("edge_index", len(edges)) < len(edges):
            edge, snapped = edges[point["edge_index"]], [point["lat"], point["lon"]]
            anchors.append((index, locate(shape, edge["begin_shape_index"], edge["end_shape_index"], snapped), snapped))
    if not anchors:
        return [(False, points)]
    types = [point["type"] for point in data["matched_points"]]
    links = []
    for (i, a, start), (j, b, end) in zip(anchors, anchors[1:]):
        between = [*shape[math.floor(a) + 1 : math.ceil(b)], end] if b >= a else [end]
        # Never bridge fixes the matcher could not place, and snap only when the mapped path is
        # about as long as the walk: far longer is a detour, far shorter skips an excursion.
        snapped, recorded = length([start, *between]), length(points[i : j + 1])
        placed = all(types[k] != "unmatched" for k in range(i + 1, j))
        links.append((i, j, between, placed and recorded / 2 - 30 <= snapped <= 1.5 * recorded + 40))
    # Brief matches would flip the line between trail and GPS; keep only sustained runs.
    runs = []
    for link in links:
        if runs and runs[-1][0] == link[3]:
            runs[-1][1].append(link)
        else:
            runs.append((link[3], [link]))
    first = anchors[0]
    pieces = [(False, [*points[: first[0]], first[2]])]
    previous = first[2]
    for snapped, group in runs:
        if snapped and len(group) >= MIN_RUN:
            piece = [previous, *(p for link in group for p in link[2])]
        else:
            piece = [previous, *points[group[0][0] + 1 : group[-1][1]], group[-1][2][-1]]
        pieces.append((snapped and len(group) >= MIN_RUN, piece))
        previous = piece[-1]
    pieces.append((False, [previous, *points[anchors[-1][0] + 1 :]]))
    return pieces


def match_segment(points, profile, cache):
    points = tidy(points, SPACING_M[profile])
    if len(points) < 2:
        return points, 0, 0
    pieces = []
    for start in range(0, len(points) - 1, CHUNK - 1):
        for snapped, piece in match_chunk(points[start : start + CHUNK], profile, cache):
            if pieces and pieces[-1][0] == snapped:
                pieces[-1] = (snapped, [*pieces[-1][1], *piece[1:]])
            elif len(piece) > 1:
                pieces.append((snapped, piece))
    out, matched, total = [], 0, 0
    for snapped, piece in pieces:
        out.extend((piece if snapped else chaikin(piece))[1 if out else 0 :])
        matched += length(piece) if snapped else 0
        total += length(piece)
    return simplify(out, 2), matched, total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path, help="Directory for cached Valhalla responses")
    parser.add_argument(
        "--data", type=Path, default=Path(__file__).resolve().parents[2] / "assets/data/travel/activities.json"
    )
    parser.add_argument("--force", action="store_true", help="Rematch tracks that were already matched")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    document = json.loads(args.data.read_text())
    for journey in document["journeys"]:
        for day in journey["days"]:
            profile = PROFILES.get(day["type"])
            if not profile or (day["source"].get("matched") and not args.force):
                continue
            before = sum(map(len, day["segments"]))
            segments, matched, total = [], 0, 0
            for segment in day["segments"]:
                coords, snapped, size = match_segment(segment, profile, args.cache)
                if len(coords) >= 2:
                    segments.append(coords)
                matched, total = matched + snapped, total + size
            day["segments"] = segments
            day["source"].update(
                matched=f"Valhalla {profile} · OpenStreetMap",
                matched_share=round(matched / max(total, 1), 2),
                display_points=sum(map(len, segments)),
            )
            print(
                f"{day['id']} {day['type']}: {before} → {day['source']['display_points']} points, "
                f"{day['source']['matched_share']:.0%} on mapped paths",
                flush=True,
            )
    args.data.write_text(json.dumps(document, separators=(",", ":"), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
