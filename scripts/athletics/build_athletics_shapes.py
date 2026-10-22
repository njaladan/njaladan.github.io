"""Build assets/data/athletics/shapes.json: every GPS activity as a normalized route shape.

    python -m scripts.athletics.build_athletics_shapes STRAVA_ACTIVITIES_DIR SUMMARY.json

Each shape is scaled into a 0-1000 box with no real coordinates, so the page shows what
a route looks like, not where it was. Lines break at pauses and GPS glitches (the same
rules as summarize_strava.py), so a train ride between two rides is not drawn. When a
train or car leg splits an activity between two places, only the much longer part is drawn.
"""

import json
import math
import sys
from datetime import datetime, timedelta
from itertools import pairwise
from pathlib import Path

from scripts.athletics import summarize_strava as strava
from scripts.common.geo import distance_m
from scripts.common.paths import ATHLETICS_DATA

SPORTS = {"running": "run", "cycling": "ride", "hiking": "foot", "walking": "foot", "snowboarding": "snow"}
PLACE_JUMP_M = 5000
DOMINANT = 3  # the kept place must be at least this many times longer than the rest


def local_date(row):
    start = datetime.fromisoformat(row["start_utc"])
    offset = (row["start_area"][1] / 15) if row.get("start_area") else -5
    return (start + timedelta(hours=offset)).date()


def dedupe(rows):
    """Drop activities saved twice: keep the longest of any same-sport recordings that overlap by half."""
    spans = []
    for r in rows:
        start = datetime.fromisoformat(r["start_utc"])
        spans.append((start, start + timedelta(seconds=max(r["elapsed_s"], 1)), r))
    drop = set()
    for i, (s1, e1, a) in enumerate(spans):
        for s2, e2, b in spans[i + 1 :]:
            if SPORTS.get(a["type"], a["type"]) != SPORTS.get(b["type"], b["type"]):
                continue
            overlap = (min(e1, e2) - max(s1, s2)).total_seconds()
            if overlap > 0.5 * min((e1 - s1).total_seconds(), (e2 - s2).total_seconds()):
                drop.add(id(min(a, b, key=lambda r: r["distance_m"])))
    return [r for r in rows if id(r) not in drop]


def simplify(points, epsilon):
    """Ramer-Douglas-Peucker on [x, y] points."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    worst, index = 0, 0
    for i in range(1, len(points) - 1):
        x, y = points[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm if norm > 1e-9 else math.hypot(x - x1, y - y1)
        if d > worst:
            worst, index = d, i
    if worst <= epsilon:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], epsilon)[:-1] + simplify(points[index:], epsilon)


def segments(path, kind):
    data = strava.open_bytes(path)
    pts = strava.parse_gpx(data)[2] if ".gpx" in path.name else strava.parse_fit(data)[2]
    geo = [p for p in pts if p[0] is not None]
    cap = strava.MAX_SPEED.get(kind, 15)
    out, current, prev = [], [], None
    for p in geo:
        if prev is not None:
            dt = (p[2] - prev[2]).total_seconds() if p[2] and prev[2] else None
            if dt is not None and (dt <= 0 or dt > strava.MAX_GAP_S or distance_m(prev, p) / dt > cap):
                if len(current) > 1:
                    out.append(current)
                current = []
        current.append((p[0], p[1]))
        prev = p
    if len(current) > 1:
        out.append(current)
    return largest_place(out)


def largest_place(segs):
    """Keep the longest group of segments that are near each other.

    A pause followed by a jump of more than PLACE_JUMP_M (a train or car leg) starts a new
    place; drawing both places in one box leaves a mostly empty shape, so only the place
    with the most tracked distance is kept, if it is at least DOMINANT times longer
    than everything else combined.
    """
    groups = []
    for seg in segs:
        if groups and distance_m(groups[-1][-1][-1], seg[0]) <= PLACE_JUMP_M:
            groups[-1].append(seg)
        else:
            groups.append([seg])
    if len(groups) < 2:
        return segs

    def length(group):
        return sum(distance_m(a, b) for s in group for a, b in pairwise(s))

    longest = max(groups, key=length)
    rest = sum(length(g) for g in groups if g is not longest)
    # Crop only when one place clearly dominates; otherwise draw every part.
    return longest if length(longest) >= DOMINANT * rest else segs


def shape(segs):
    lat0 = sum(p[0] for s in segs for p in s) / sum(len(s) for s in segs)
    k = math.cos(math.radians(lat0))
    xy = [[(p[1] * k, -p[0]) for p in s] for s in segs]
    xs = [x for s in xy for x, _ in s]
    ys = [y for s in xy for _, y in s]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    span = max(w, h)
    if span < 1e-5:
        return None
    ox, oy = min(xs) - (span - w) / 2, min(ys) - (span - h) / 2
    scaled = [[((x - ox) / span * 1000, (y - oy) / span * 1000) for x, y in s] for s in xy]
    simple = [simplify(s, 3.5) for s in scaled]
    return [[round(v) for p in s for v in p] for s in simple if len(s) > 1]


def main(activities, summary_path):
    rows = dedupe([r for r in json.load(open(summary_path)) if "error" not in r and r.get("start_utc")])
    shapes = []
    for r in rows:
        if r["distance_m"] < 400 or not r.get("start_area"):
            continue
        try:
            segs = segments(Path(activities) / r["file"], r["type"])
        except Exception:  # noqa: BLE001 - a broken file just has no shape
            continue
        if not segs or sum(len(s) for s in segs) < 15:
            continue
        s = shape(segs)
        if not s:
            continue
        shapes.append({"date": local_date(r).isoformat(), "sport": SPORTS.get(r["type"], "other"), "segs": s})
    shapes.sort(key=lambda s: s["date"], reverse=True)
    out = ATHLETICS_DATA / "shapes.json"
    out.write_text(json.dumps(shapes, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {len(shapes)} shapes)")


if __name__ == "__main__":
    main(*sys.argv[1:3])
