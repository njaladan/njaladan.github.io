"""Geographic helpers."""

import math

# Mean Earth radius in metres (IUGG).
EARTH_RADIUS_M = 6371008.8


def distance_m(a, b):
    """Great-circle distance in metres between two (lat, lon) points in degrees."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1, math.sqrt(h)))
