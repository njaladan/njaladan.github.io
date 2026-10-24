"""GPS points from a Strava export (and loose .fit files), cached per file.

GPX and TCX are read with regular expressions, which is far faster than an XML parser
on a thousand files; FIT goes through summarize_strava's fitdecode reader.
"""

import pickle
import re
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from scripts.athletics import summarize_strava as strava

GPX_POINT = re.compile(
    rb'<trkpt[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"|<trkpt[^>]*?lon="([-\d.]+)"[^>]*?lat="([-\d.]+)"'
)
BIKE = {"cycling", "biking", "ebikeride"}
# Activities with no point in this box never reach Manhattan and are skipped early.
NEAR = (40.68, 40.885, -74.03, -73.90)
CACHE_VERSION = 1


@dataclass
class Activity:
    name: str
    sport: str
    date: str  # YYYY-MM-DD, from the first timestamp (UTC)
    lonlat: np.ndarray

    @property
    def bike(self):
        return self.sport.lower() in BIKE


def first(pattern, data):
    m = re.search(pattern, data)
    return m.group(1).decode() if m else ""


def parse(path):
    data = strava.open_bytes(path)
    if ".gpx" in path.name:
        pts = [(float(m[1]), float(m[0])) if m[0] else (float(m[2]), float(m[3])) for m in GPX_POINT.findall(data)]
        return first(rb"<type>([^<]*)</type>", data), first(rb"<time>(\d{4}-\d\d-\d\d)", data), pts
    if ".tcx" in path.name:
        lat = re.findall(rb"<LatitudeDegrees>([-\d.]+)", data)
        lon = re.findall(rb"<LongitudeDegrees>([-\d.]+)", data)
        pts = [(float(b), float(a)) for a, b in zip(lat, lon, strict=False)]
        return first(rb'Sport="(\w+)"', data), first(rb"<Id>(\d{4}-\d\d-\d\d)", data), pts
    _, sport, records, _ = strava.parse_fit(data)
    stamps = [r[2] for r in records if r[2] is not None]
    pts = [(r[1], r[0]) for r in records if r[0] is not None]
    return sport, stamps[0].date().isoformat() if stamps else "", pts


def read(args):
    path, cache = args
    cached = cache / f"{path.name}.pkl" if cache else None
    if cached and cached.exists():
        version, result = pickle.loads(cached.read_bytes())
        if version == CACHE_VERSION:
            return result
    try:
        sport, date, pts = parse(path)
    except Exception:  # noqa: BLE001 - a broken file just has no points
        sport, date, pts = "", "", []
    result = (path.name, strava.ALIASES.get(sport, sport), date, np.array(pts).reshape(-1, 2))
    if cached:
        cached.write_bytes(pickle.dumps((CACHE_VERSION, result)))
    return result


def near_manhattan(lonlat):
    s, n, w, e = NEAR
    return bool(((lonlat[:, 1] > s) & (lonlat[:, 1] < n) & (lonlat[:, 0] > w) & (lonlat[:, 0] < e)).any())


def load(sources, cache=None):
    """Activities that come near Manhattan, sorted by date. `sources` are export folders
    or single activity files; `cache` is a folder for parsed points."""
    files = []
    for source in map(Path, sources):
        files += sorted(p for p in source.iterdir() if not p.name.startswith(".")) if source.is_dir() else [source]
    if cache:
        Path(cache).mkdir(parents=True, exist_ok=True)
    with Pool() as pool:
        rows = pool.map(read, [(f, Path(cache) if cache else None) for f in files], chunksize=8)
    acts = [Activity(*row) for row in rows if row[2] and len(row[3]) and near_manhattan(row[3])]
    return sorted(acts, key=lambda a: (a.date, a.name))
