"""Add new rides, runs or walks to the Manhattan coverage page, one file or a few at a time.

    python -m scripts.street_coverage.add new_ride.fit [another.fit ...]

Hit-tests just these files against the street samples in state.json, then rewrites
_data/manhattan_coverage.json, the map in assets/data/athletics/manhattan.json and
state.json. No export is needed; a file already counted is skipped. The activity files
themselves stay out of the repository: only their snapped Manhattan pieces are published.
"""

import argparse
import json
from pathlib import Path

from scripts.street_coverage import activities, build, coverage, network, state


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("files", nargs="+", type=Path, help=".fit, .gpx or .tcx files (optionally .gz)")
    args = parser.parse_args()

    boundary = network.load_boundary()
    cov = coverage.Coverage(network.segments(boundary))
    first, latest, added = state.load(cov.samples)

    fresh = [p for p in args.files if state.file_hash(p) not in added]
    for p in sorted(set(args.files) - set(fresh)):
        print(f"{p.name}: already counted, skipped")
    acts = activities.load(fresh)
    for name in sorted({p.name for p in fresh} - {a.name for a in acts}):
        print(f"{name}: no points near Manhattan, nothing to add")
    if not acts:
        return

    published = json.loads(build.MAP.read_text())["tracks"]
    for a in acts:
        if any(t["d"] == a.date for t in published):
            print(f"{a.name}: the map already has a track from {a.date}; if it's this one, undo and skip this file")
    xy = [network.project(a.lonlat) for a in acts]
    new_first = cov.first_hits(xy, [a.date for a in acts], first)
    new_latest = max([latest] + [a.date for a in acts])
    label = ", ".join(f"{a.name} ({a.date})" for a in acts)
    build.report(cov, label, cov.covered(first, new_latest), cov.covered(new_first, new_latest))

    tracks = published + build.snapped(boundary, acts, xy)
    hashes = added | {state.file_hash(p) for p in fresh}
    build.write(boundary, cov, new_first, new_latest, tracks, hashes)


if __name__ == "__main__":
    main()
