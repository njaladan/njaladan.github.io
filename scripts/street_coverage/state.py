"""What the page's figures are computed from, kept in the repository so a new ride can be
added on its own: the date each segment sample was first hit (run-length encoded), and a
hash of every activity file already counted. Only street samples inside Manhattan and
dates are stored, nothing about where an activity started or went off the island.
"""

import hashlib
import json

import numpy as np

from scripts.common.paths import REPO

PATH = REPO / "scripts/street_coverage/state.json"


def fingerprint(samples):
    """Changes whenever the street network (and so the sample list) does."""
    return hashlib.sha1(np.round(samples).astype(np.int64).tobytes()).hexdigest()[:16]


def file_hash(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:16]


def save(samples, first, latest, added):
    runs, start = [], 0
    for i in range(1, len(first) + 1):
        if i == len(first) or first[i] != first[start]:
            runs.append([i - start, str(first[start])])
            start = i
    state = {
        "network": fingerprint(samples),
        "latest": latest,
        "added": sorted(set(added)),
        "firstHit": runs,
    }
    PATH.write_text(json.dumps(state, separators=(",", ":")) + "\n")


def load(samples):
    """(first hit per sample, latest activity date, hashes of files counted)."""
    state = json.loads(PATH.read_text())
    if state["network"] != fingerprint(samples):
        raise SystemExit(
            f"{PATH.name} was built against a different street network; rebuild it from a full export with build.py"
        )
    first = np.concatenate([np.full(n, d, "U10") for n, d in state["firstHit"]])
    return first, state["latest"], set(state["added"])
