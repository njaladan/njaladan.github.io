"""Which segments the activities cover.

A segment sample is hit when a track point within 25 m was heading within 35 degrees of
the segment's bearing, so crossing a street doesn't count. A segment is covered once
half its samples are hit, and covered pieces adding up to under 100 m on their own
(crosswalks over the West Side Highway median, park drives over the transverses) are
dropped.
"""

from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree

HIT_M = 25
HIT_ANGLE = np.radians(35)
DENSIFY_M = 5
# Longer jumps between points are GPS dropouts or subway rides, not travel.
MAX_LEG_M = 60
COVERED_SHARE = 0.5
MIN_COMPONENT_M = 100


def densify(xy):
    """Points every DENSIFY_M along each leg up to MAX_LEG_M, each with its leg's heading."""
    pts, headings = [], []
    for a, b in zip(xy[:-1], xy[1:], strict=True):
        d = np.hypot(*(b - a))
        if d == 0 or d > MAX_LEG_M:
            continue
        n = max(int(d // DENSIFY_M), 1)
        pts.append(a + np.outer(np.arange(n) / n, b - a))
        headings.append(np.full(n, np.arctan2(b[1] - a[1], b[0] - a[0]) % np.pi))
    if not pts:
        return np.zeros((0, 2)), np.zeros(0)
    return np.vstack(pts), np.concatenate(headings)


class Coverage:
    """Hit tests the segment samples against tracks, one track at a time, so the date each
    sample was first hit can be kept and later tracks added without the earlier ones."""

    def __init__(self, segs):
        self.segs = segs
        self.samples = np.vstack([s.samples for s in segs])
        self.bearings = np.concatenate([s.bearings for s in segs])
        self.owner = np.repeat(np.arange(len(segs)), [len(s.samples) for s in segs])
        self.lengths = np.array([s.length for s in segs], float)
        self.tree = cKDTree(self.samples)

    def hits(self, xy):
        """Boolean per sample: hit by this track."""
        hit = np.zeros(len(self.samples), bool)
        pts, headings = densify(xy)
        if not len(pts):
            return hit
        for p, h in zip(self.tree.query_ball_point(pts, HIT_M), headings, strict=True):
            if p:
                p = np.array(p)
                diff = np.abs((self.bearings[p] - h + np.pi / 2) % np.pi - np.pi / 2)
                hit[p[diff < HIT_ANGLE]] = True
        return hit

    def first_hits(self, tracks, dates, first=None):
        """Per sample, the earliest date (YYYY-MM-DD) any track hit it, or "" if none did,
        starting from an earlier `first`."""
        first = np.full(len(self.samples), "", "U10") if first is None else first.copy()
        for xy, date in zip(tracks, dates, strict=True):
            hit = self.hits(xy) & ((first == "") | (first > date))
            first[hit] = date
        return first

    def covered(self, first, upto):
        """Boolean per segment, counting the samples first hit on or before `upto`."""
        hit = (first != "") & (first <= upto)
        share = np.bincount(self.owner, hit, len(self.segs)) / np.bincount(self.owner, minlength=len(self.segs))
        return self.drop_small(share >= COVERED_SHARE)

    def drop_small(self, cov):
        """Un-covers groups of touching covered segments shorter than MIN_COMPONENT_M."""
        parent = {}

        def find(a):
            while parent.setdefault(a, a) != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        ends = {i: [tuple(np.round(self.segs[i].xy[k])) for k in (0, -1)] for i in np.flatnonzero(cov)}
        for a, b in ends.values():
            parent[find(a)] = find(b)
        total = defaultdict(float)
        for i, (a, _) in ends.items():
            total[find(a)] += self.lengths[i]
        out = cov.copy()
        for i, (a, _) in ends.items():
            if total[find(a)] < MIN_COMPONENT_M:
                out[i] = False
        return out

    def km(self, mask):
        return self.lengths[mask].sum() / 1000


def band_sides(segs):
    """Signed distance in metres of each segment's midpoint north of 14th, 34th and 59th
    Streets, from lines fitted through those streets (59th includes Central Park South)."""
    mids = np.array([s.xy[len(s.xy) // 2] for s in segs])

    def side(names):
        pts = np.vstack([s.xy for s in segs if s.name in names])
        centre = pts.mean(0)
        direction = np.linalg.svd(pts - centre)[2][0]
        normal = np.array([-direction[1], direction[0]])
        normal = normal if normal[1] > 0 else -normal
        return (mids - centre) @ normal

    return {
        14: side({"East 14th Street", "West 14th Street"}),
        34: side({"East 34th Street", "West 34th Street"}),
        59: side({"East 59th Street", "West 59th Street", "Central Park South"}),
    }


def bands(segs):
    """Masks for the neighbourhood bands; a street itself counts as south of its line."""
    s = {k: v <= 10 for k, v in band_sides(segs).items()}
    return {
        "Below 14th St": s[14],
        "14th–34th St": ~s[14] & s[34],
        "34th–59th St": ~s[34] & s[59],
        "North of 59th St": ~s[59],
    }
