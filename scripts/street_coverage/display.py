"""Tracks prepared for the page. None of this changes the coverage figures.

Only points within 60 m of Manhattan's shore are published, so nothing near home or
anywhere else leaves the export. The kept pieces are de-jagged and snapped to the path
network with a small Viterbi matcher, which removes building-canyon wobble and the
"ladder" between the Hudson greenway's bike path and walkway.
"""

import numpy as np
import shapely
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree
from shapely.geometry import LineString

from scripts.street_coverage.network import project

PRIVACY_M = 60
PIECE_GAP_M = 80
MIN_INSIDE = 5
RESAMPLE_M = 4
SNAP_STEP_M = 2
SNAP_RADIUS_M = 22
SNAP_ANGLE = np.radians(35)
SNAP_ANY_ANGLE_M = 6  # at intersections any direction will do
UNSNAPPED_COST = 16.0
SWITCH_COST = 18.0
SNAP_WAYS = {
    "primary", "secondary", "tertiary", "residential", "unclassified", "living_street", "pedestrian",
    "cycleway", "path", "track", "bridleway", "primary_link", "secondary_link", "tertiary_link",
}  # fmt: skip


def pieces(xy, keep):
    """Runs of kept points, broken wherever consecutive kept points are PIECE_GAP_M apart."""
    out, current = [], []
    for p, inside in zip(xy, keep, strict=True):
        if inside and (not current or np.hypot(*(p - current[-1])) < PIECE_GAP_M):
            current.append(p)
            continue
        if len(current) > 2:
            out.append(np.array(current))
        current = [p] if inside else []
    if len(current) > 2:
        out.append(np.array(current))
    return out


def clip(boundary, xy):
    """Manhattan pieces of a track, or none if it barely touches the island."""
    area = boundary.buffer(PRIVACY_M)
    shapely.prepare(area)
    inside = shapely.contains_xy(area, xy[:, 0], xy[:, 1])
    return pieces(xy, inside) if inside.sum() >= MIN_INSIDE else []


def resample(p, step=RESAMPLE_M):
    along = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
    if along[-1] < step * 3:
        return p
    at = np.arange(0, along[-1], step)
    return np.column_stack([np.interp(at, along, p[:, 0]), np.interp(at, along, p[:, 1])])


def despike(p):
    """Drops points where the path doubles back over a short distance (GPS spikes)."""
    keep = np.ones(len(p), bool)
    for _ in range(3):
        q = p[keep]
        if len(q) < 3:
            break
        a, b = q[1:-1] - q[:-2], q[2:] - q[1:-1]
        la, lb = np.hypot(*a.T), np.hypot(*b.T)
        bad = ((a * b).sum(1) / np.maximum(la * lb, 1e-9) < -0.6) & (np.minimum(la, lb) < 40)
        if not bad.any():
            break
        keep[np.flatnonzero(keep)[1:-1][bad]] = False
    return p[keep]


def smooth(p, sigma):
    return np.column_stack([gaussian_filter1d(p[:, i], sigma, mode="nearest") for i in (0, 1)])


class Snapper:
    """Map-matches pieces to the OSM ways in SNAP_WAYS, sampled every 2 m."""

    def __init__(self, ways):
        pts, bearings, owners = [], [], []
        for way in ways:
            t = way["tags"]
            h = t.get("highway")
            ok = h in SNAP_WAYS or (h == "footway" and t.get("footway") not in ("sidewalk", "crossing"))
            if not ok or t.get("area") == "yes":
                continue
            xy = project(np.array([(g["lon"], g["lat"]) for g in way["geometry"]]))
            for a, b in zip(xy[:-1], xy[1:], strict=True):
                n = max(int(np.hypot(*(b - a)) // SNAP_STEP_M), 1)
                pts.append(a + np.outer(np.arange(n) / n, b - a))
                bearings.append(np.full(n, np.arctan2(b[1] - a[1], b[0] - a[0])))
                owners.append(np.full(n, way["id"]))
        self.pts, self.bearings, self.owners = np.vstack(pts), np.concatenate(bearings), np.concatenate(owners)
        self.tree = cKDTree(self.pts)

    def candidates(self, q):
        """Per point, the nearest sample of each nearby way running the same way (None = unsnapped)."""
        step = np.diff(np.vstack([q, q[-1:] + (q[-1:] - q[-2:-1])]), axis=0)
        h = np.arctan2(step[:, 1], step[:, 0])
        h = np.arctan2(gaussian_filter1d(np.sin(h), 3), gaussian_filter1d(np.cos(h), 3))
        dist, idx = self.tree.query(q, k=16, distance_upper_bound=SNAP_RADIUS_M)
        out = []
        for j in range(len(q)):
            c = {None: (UNSNAPPED_COST, -1)}
            for d, i in zip(dist[j], idx[j], strict=True):
                if not np.isfinite(d):
                    break
                angle = abs((self.bearings[i] - h[j] + np.pi / 2) % np.pi - np.pi / 2)
                if angle > SNAP_ANGLE and d > SNAP_ANY_ANGLE_M:
                    continue
                w = self.owners[i]
                if w not in c or d < c[w][0]:
                    c[w] = (d, i)
            out.append(c)
        return out

    def snap(self, p):
        q = smooth(resample(despike(p)), 2.5) if len(p) >= 5 else p
        if len(q) < 3:
            return q
        cands = self.candidates(q)
        cost = {k: v[0] for k, v in cands[0].items()}
        back = []
        for c in cands[1:]:
            best = min(cost, key=cost.get)
            switch = cost[best] + SWITCH_COST
            step, came = {}, {}
            for k, (d, _) in c.items():
                stay = cost.get(k, np.inf)
                step[k], came[k] = (stay + d, k) if stay <= switch else (switch + d, best)
            cost = step
            back.append(came)
        label = [min(cost, key=cost.get)]
        for came in reversed(back):
            label.append(came[label[-1]])
        out = q.copy()
        for j, k in enumerate(reversed(label)):
            if k is not None:
                out[j] = self.pts[cands[j][k][1]]
        return smooth(out, 1.5)


def encode(xy, origin, q, tolerance):
    """Simplifies a line, then writes it in q-metre units from `origin`, delta-encoded."""
    line = LineString(xy).simplify(tolerance)
    a = np.round((np.array(line.coords) - origin) / q).astype(int)
    d = np.vstack([a[:1], np.diff(a, axis=0)])
    d = d[(d != 0).any(1) | (np.arange(len(d)) == 0)]
    return d.ravel().tolist()


def decode(flat, origin, q):
    a = np.cumsum(np.array(flat, float).reshape(-1, 2), axis=0)
    return a * q + origin


def clipped_lines(lines, boundary, buffer_m=15):
    """The parts of each line within `buffer_m` of the shore."""
    area = boundary.buffer(buffer_m)
    shapely.prepare(area)
    for xy in lines:
        line = LineString(xy)
        if area.contains(line):
            yield xy
            continue
        part = line.intersection(area)
        for g in getattr(part, "geoms", [part]):
            if g.geom_type == "LineString" and not g.is_empty:
                yield np.array(g.coords)


def shoreline(boundary, origin, q, min_area=20000):
    """Each island's outline, simplified, for the land fill."""
    polys = getattr(boundary, "geoms", [boundary])
    return [encode(np.array(p.exterior.coords), origin, q, 4) for p in polys if p.area >= min_area]
