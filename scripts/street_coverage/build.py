"""Rebuild the Manhattan coverage page's data from a full Strava export.

    python -m scripts.street_coverage.build EXPORT/activities [new_ride.fit ...] [--cache DIR]

Writes _data/manhattan_coverage.json (the figures, rendered into the page),
assets/data/athletics/manhattan.json (the map) and state.json (what later rides are
added to with add.py), then prints what the newest day added. Published rides dated
after everything given here are carried over from the current map, so a ride added
earlier isn't lost when it's missing from a fresh export.
"""

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from scripts.common.paths import ATHLETICS_DATA, DATA
from scripts.street_coverage import activities, coverage, display, network, state

SUMMARY = DATA / "manhattan_coverage.json"
MAP = ATHLETICS_DATA / "manhattan.json"
Q = 2.0  # metres per published unit
FIRST_YEAR_SHOWN = 2019


def dedupe(acts, xy):
    """Indices of activities, minus second copies (same day and start, similar length)."""
    lengths = [np.hypot(*np.diff(p, axis=0).T).sum() for p in xy]
    keep = []
    for i in sorted(range(len(acts)), key=lambda i: -len(xy[i])):
        same = any(
            acts[j].date == acts[i].date
            and np.hypot(*(xy[j][0] - xy[i][0])) < 300
            and abs(lengths[j] - lengths[i]) < 0.1 * max(lengths[j], 1)
            for j in keep
        )
        if not same:
            keep.append(i)
    return sorted(keep)


def carried_over(after, origin):
    """Published tracks newer than `after`, decoded back to metres. They were simplified
    into long straight legs, so they're resampled to look like raw GPS again."""
    if not MAP.exists():
        return []
    old = json.loads(MAP.read_text())
    return [
        t | {"xy": [display.resample(display.decode(p, origin, old["q"])) for p in t["p"]]}
        for t in old["tracks"]
        if t["d"] > after
    ]


def summary(cov, first, latest, bands):
    total = np.ones(len(cov.segs), bool)
    final = cov.covered(first, latest)
    pct = lambda mask: round(100 * cov.km(mask) / cov.km(total), 2)  # noqa: E731
    years = range(FIRST_YEAR_SHOWN, int(latest[:4]) + 1)
    return {
        "asOf": latest,
        "now": pct(final),
        "km": [round(cov.km(final), 1), round(cov.km(total), 1)],
        "years": {str(y): pct(cov.covered(first, f"{y}-12-31")) for y in years},
        "bands": [
            {"name": name, "done": round(cov.km(mask & final), 1), "total": round(cov.km(mask), 1)}
            for name, mask in bands.items()
        ],
    }


def day_before(d):
    return (date.fromisoformat(d) - timedelta(days=1)).isoformat()


def report(cov, label, before, after):
    gained = after & ~before
    names = sorted({s.name for s, g in zip(cov.segs, gained, strict=True) if g and s.name})
    total = cov.km(np.ones_like(after))
    print(
        f"{label}: +{cov.km(gained):.1f} km, "
        f"{100 * cov.km(before) / total:.2f}% -> {100 * cov.km(after) / total:.2f}% "
        f"({cov.km(after):.1f} of {total:.1f} km)"
    )
    if names:
        print("  " + ", ".join(names))


def map_data(boundary, segs, final, tracks):
    x0, y0, x1, y1 = boundary.bounds
    origin = np.array([x0, y0])
    lines = lambda mask: [  # noqa: E731
        display.encode(xy, origin, Q, 2)
        for xy in display.clipped_lines([s.xy for s, m in zip(segs, mask, strict=True) if m], boundary)
    ]
    return {
        "w": round((x1 - x0) / Q),
        "h": round((y1 - y0) / Q),
        "q": Q,
        "tracks": tracks,
        "net": lines(np.ones(len(segs), bool)),
        "covered": lines(final),
        "land": display.shoreline(boundary, origin, Q),
    }


def snapped(boundary, acts, xy):
    """Map tracks for new activities: their Manhattan pieces, snapped and encoded."""
    origin = np.array(boundary.bounds[:2])
    snapper = display.Snapper(network.load_ways())
    tracks = []
    for a, p in zip(acts, xy, strict=True):
        pieces = [snapper.snap(piece) for piece in display.clip(boundary, p)]
        if pieces:
            tracks.append({"d": a.date, "b": int(a.bike), "p": [display.encode(s, origin, Q, 1.2) for s in pieces]})
    return tracks


def write(boundary, cov, first, latest, tracks, added):
    tracks = sorted(tracks, key=lambda t: t["d"])
    final = cov.covered(first, latest)
    figures = summary(cov, first, latest, coverage.bands(cov.segs))
    SUMMARY.write_text(json.dumps(figures, indent=2, ensure_ascii=False) + "\n")
    MAP.write_text(json.dumps(map_data(boundary, cov.segs, final, tracks), separators=(",", ":")) + "\n")
    state.save(cov.samples, first, latest, added)
    size = MAP.stat().st_size // 1024
    print(f"wrote {SUMMARY.name}, {state.PATH.name} and {MAP.name} ({size} KB, {len(tracks)} tracks)")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("sources", nargs="+", help="Strava export activities folders or single activity files")
    parser.add_argument("--cache", help="folder for parsed activity points, to speed up reruns")
    args = parser.parse_args()

    boundary = network.load_boundary()
    origin = np.array(boundary.bounds[:2])
    acts = activities.load(args.sources, args.cache)
    xy = [network.project(a.lonlat) for a in acts]
    keep = dedupe(acts, xy)
    acts, xy = [acts[i] for i in keep], [xy[i] for i in keep]
    extra = carried_over(acts[-1].date, origin)
    # A carried-over track is already split at its gaps, so each piece is hit-tested on its own.
    pieces = xy + [p for t in extra for p in t["xy"]]
    dates = [a.date for a in acts] + [t["d"] for t in extra for _ in t["xy"]]
    cov = coverage.Coverage(network.segments(boundary))
    first = cov.first_hits(pieces, dates)
    latest = max(dates)
    report(cov, latest, cov.covered(first, day_before(latest)), cov.covered(first, latest))

    tracks = snapped(boundary, acts, xy) + [{"d": t["d"], "b": t["b"], "p": t["p"]} for t in extra]
    added = [state.file_hash(p) for p in map(Path, args.sources) if p.is_file()]
    write(boundary, cov, first, latest, tracks, added)


if __name__ == "__main__":
    main()
