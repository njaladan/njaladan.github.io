"""Repository locations the importers read and write."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "assets"
DATA = REPO / "_data"
ATHLETICS_DATA = ASSETS / "data/athletics"
TRAVEL_DATA = ASSETS / "data/travel"
