"""Manhattan's street and path network, split into segments and sampled every 10 m.

The OpenStreetMap ways and the shoreline come from the caches in cache/, so results only
change when those are refreshed (see fetch_osm). Everything is in UTM 18N metres.
"""

import gzip
import json
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape

CACHE = Path(__file__).parent / "cache"
OSM_CACHE = CACHE / "manhattan_osm.json.gz"
BOUNDARY_CACHE = CACHE / "manhattan_boundary.geojson"

# overpass-api.de is often unreachable from cloud containers; this mirror answers the same query.
OVERPASS = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
OVERPASS_QUERY = """[out:json][timeout:170];
area["name"="Manhattan"]["boundary"="administrative"]["admin_level"="7"]->.a;
(way["highway"](area.a););
out geom tags;"""

TO_UTM = Transformer.from_crs(4326, 32618, always_xy=True)
TO_LATLON = Transformer.from_crs(32618, 4326, always_xy=True)

STREETS = {"primary", "secondary", "tertiary", "residential", "unclassified", "living_street"}
# Paths count when they have a name: greenways, esplanades, park drives and trails. Unnamed
# ones are mostly sidewalks drawn separately, protected bike lanes beside an avenue, and
# plaza or campus walkways.
PATHS = {"pedestrian", "cycleway", "footway", "path", "track", "bridleway"}
HIGHWAYS = (
    "FDR Drive",
    "Franklin D. Roosevelt",
    "Harlem River Drive",
    "Henry Hudson",
    "West Side Highway",
    "Joe DiMaggio",
)
SAMPLE_M = 10
SHORE_BUFFER_M = 30


def counts(tags):
    """Whether a way is part of the network that coverage is measured against."""
    highway = tags.get("highway")
    if highway not in STREETS and highway not in PATHS:
        return False
    if highway in PATHS and not tags.get("name"):
        return False
    if tags.get("footway") in ("sidewalk", "crossing") or tags.get("indoor") == "yes":
        return False
    if tags.get("area") == "yes" or tags.get("access") in ("private", "no"):
        return False
    names = tags.get("name", "") + tags.get("alt_name", "") + tags.get("official_name", "")
    if any(h in names for h in HIGHWAYS):
        return False
    # River crossings: the Brooklyn, Washington, Madison Ave and other bridges and their walkways.
    return not (tags.get("bridge", "no") != "no" and "Bridge" in names)


def project(lonlat):
    x, y = TO_UTM.transform(lonlat[:, 0], lonlat[:, 1])
    return np.column_stack([x, y])


def fetch_osm():
    """Refreshes the OpenStreetMap cache; coverage figures move slightly with OSM edits."""
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    with urllib.request.urlopen(OVERPASS, body, timeout=200) as response:
        OSM_CACHE.write_bytes(gzip.compress(response.read()))


def load_boundary():
    """Manhattan's shoreline (NYC DCP, including the islands and Marble Hill) in UTM."""
    feature = json.loads(BOUNDARY_CACHE.read_text())["features"][0]
    return shapely.transform(shape(feature["geometry"]), project)


def load_ways():
    if not OSM_CACHE.exists():
        fetch_osm()
    elements = json.loads(gzip.decompress(OSM_CACHE.read_bytes()))["elements"]
    return [e for e in elements if e["type"] == "way" and "geometry" in e and "tags" in e]


@dataclass
class Segment:
    """A stretch of one way between intersections, with its in-Manhattan samples."""

    xy: np.ndarray
    name: str
    highway: str
    samples: np.ndarray = field(repr=False)
    bearings: np.ndarray = field(repr=False)

    @property
    def length(self):
        return len(self.samples) * SAMPLE_M

    @property
    def is_street(self):
        return self.highway in STREETS


def split(ways):
    """Cuts each way at nodes it shares with another way. Overpass geometry has no node
    IDs, so nodes are matched on coordinates rounded to 1e-7 degrees."""
    key = [[(round(p["lat"], 7), round(p["lon"], 7)) for p in w["geometry"]] for w in ways]
    shared = Counter(n for nodes in key for n in set(nodes))
    for way, nodes in zip(ways, key, strict=True):
        xy = project(np.array([(p["lon"], p["lat"]) for p in way["geometry"]]))
        cuts = [0] + [i for i, n in enumerate(nodes[1:-1], 1) if shared[n] > 1] + [len(xy) - 1]
        for a, b in zip(cuts[:-1], cuts[1:], strict=True):
            if b > a:
                yield way["tags"], xy[a : b + 1]


def sample(xy):
    """Points every SAMPLE_M metres at the midpoints of each step, with the street's
    bearing there (undirected, 0 to pi). A segment shorter than one step gets one sample."""
    d = np.diff(xy, axis=0)
    along = np.r_[0, np.cumsum(np.hypot(d[:, 0], d[:, 1]))]
    if along[-1] == 0:
        return np.zeros((0, 2)), np.zeros(0)
    at = np.arange(SAMPLE_M / 2, along[-1], SAMPLE_M) if along[-1] > SAMPLE_M else np.array([along[-1] / 2])
    leg = np.clip(np.searchsorted(along, at) - 1, 0, len(d) - 1)
    pts = np.column_stack([np.interp(at, along, xy[:, 0]), np.interp(at, along, xy[:, 1])])
    return pts, np.arctan2(d[leg, 1], d[leg, 0]) % np.pi


def segments(boundary):
    """Every counted segment with at least one sample inside Manhattan (shore + 30 m)."""
    shore = boundary.buffer(SHORE_BUFFER_M)
    shapely.prepare(shore)
    out = []
    for tags, xy in split([w for w in load_ways() if counts(w["tags"])]):
        pts, bearings = sample(xy)
        inside = shapely.contains_xy(shore, pts[:, 0], pts[:, 1]) if len(pts) else np.zeros(0, bool)
        if inside.any():
            out.append(Segment(xy, tags.get("name", ""), tags["highway"], pts[inside], bearings[inside]))
    return out
