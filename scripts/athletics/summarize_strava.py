"""Summarize a Strava export's GPX/FIT files into one JSON row per activity.

    python scripts/athletics/summarize_strava.py STRAVA_ACTIVITIES_DIR SUMMARY.json

Distance counts only actively tracked movement. FIT files use the watch's own session
distance and timer. GPS-only files skip jumps across pauses (a train or car ride with
recording stopped), steps faster than the sport allows, and lift rides on snowboard days.
"""

import gzip, json, math, sys, re
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path
import xml.etree.ElementTree as ET

import fitdecode

FIT_SPORTS = {
    "running": "running",
    "cycling": "cycling",
    "walking": "walking",
    "hiking": "hiking",
    "training": "workout",
    "fitness_equipment": "workout",
    "swimming": "swimming",
    "alpine_skiing": "skiing",
    "snowboarding": "snowboarding",
    "rowing": "rowing",
}

MAX_GAP_S = 120
# Speeds above these (metres per second) are GPS glitches, not movement. They sit well
# above real top speeds because one-second GPS points jitter.
MAX_SPEED = {
    "running": 12,
    "walking": 7,
    "hiking": 7,
    "cycling": 30,
    "snowboarding": 40,
    "ice_skating": 15,
    "kayaking": 8,
    "swimming": 5,
}
ALIASES = {"Snowboard": "snowboarding", "IceSkate": "ice_skating", "ebikeride": "cycling"}


def hav(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def open_bytes(path):
    data = path.read_bytes()
    return gzip.decompress(data) if path.suffix == ".gz" else data


def parse_gpx(data):
    root = ET.fromstring(data)
    ns = {"g": root.tag.split("}")[0].strip("{")}
    name = root.findtext("g:trk/g:name", default="", namespaces=ns)
    kind = root.findtext("g:trk/g:type", default="", namespaces=ns)
    pts = []
    for seg in root.iterfind("g:trk/g:trkseg", ns):
        for p in seg.iterfind("g:trkpt", ns):
            t = p.findtext("g:time", namespaces=ns)
            ele = p.findtext("g:ele", namespaces=ns)
            hr = cad = None
            for el in p.iter():
                tag = el.tag.split("}")[-1]
                if tag == "hr" and el.text:
                    hr = float(el.text)
                elif tag == "cad" and el.text:
                    cad = float(el.text)
            pts.append(
                (
                    float(p.get("lat")),
                    float(p.get("lon")),
                    datetime.fromisoformat(t.replace("Z", "+00:00")) if t else None,
                    float(ele) if ele else None,
                    hr,
                    cad,
                )
            )
    return name, kind, pts


def parse_fit(data):
    pts, kind = [], ""
    session = {}
    with fitdecode.FitReader(data, error_handling=fitdecode.ErrorHandling.IGNORE) as fit:
        for frame in fit:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            if frame.name == "session":
                session = {
                    "distance": frame.get_value("total_distance", fallback=None),
                    "timer": frame.get_value("total_timer_time", fallback=None),
                }
            if frame.name in ("sport", "session") and not kind:
                v = frame.get_value("sport", fallback=None)
                if v:
                    kind = FIT_SPORTS.get(str(v), str(v))
            if frame.name == "record":
                lat = frame.get_value("position_lat", fallback=None)
                lon = frame.get_value("position_long", fallback=None)
                t = frame.get_value("timestamp", fallback=None)
                ele = frame.get_value("enhanced_altitude", fallback=None) or frame.get_value("altitude", fallback=None)
                hr = frame.get_value("heart_rate", fallback=None)
                cad = frame.get_value("cadence", fallback=None)
                if lat is not None and lon is not None:
                    lat, lon = lat * 180 / 2**31, lon * 180 / 2**31
                    pts.append((lat, lon, t, ele, hr, cad))
                elif t is not None:
                    pts.append((None, None, t, ele, hr, cad))
    return "", kind, pts, session


def summarize(path):
    path = Path(path)
    stem = re.sub(r"\.(gpx|fit)(\.gz)?$", "", path.name)
    try:
        data = open_bytes(path)
        if ".gpx" in path.name:
            (name, kind, pts), session = parse_gpx(data), {}
        else:
            name, kind, pts, session = parse_fit(data)
    except Exception as e:  # noqa: BLE001
        return {"id": stem, "file": path.name, "error": str(e)[:200]}
    geo = [p for p in pts if p[0] is not None]
    times = [p[2] for p in pts if p[2] is not None]
    dist = moving = gain = 0.0
    prev = None
    kind_key = ALIASES.get(kind, kind)
    cap = MAX_SPEED.get(kind_key, 15)
    skipped = 0.0
    uphill = set()
    if kind_key == "snowboarding":
        # A step is on a lift if the track climbs more than 3 m over the next 30 seconds.
        j = 0
        for i, p in enumerate(geo):
            if p[2] is None or p[3] is None:
                continue
            j = max(j, i)
            while j < len(geo) - 1 and (geo[j][2] is None or (geo[j][2] - p[2]).total_seconds() < 30):
                j += 1
            if geo[j][3] is not None and geo[j][3] - p[3] > 3:
                uphill.add(i + 1)
    for idx, p in enumerate(geo):
        if prev is not None:
            d = hav(prev, p)
            dt = (p[2] - prev[2]).total_seconds() if p[2] and prev[2] else None
            # Count only actively tracked movement: no jumps across pauses (trains, cars,
            # lifts with recording stopped) and nothing faster than the sport allows.
            if idx in uphill or (dt is not None and (dt <= 0 or dt > MAX_GAP_S or d / dt > cap)):
                skipped += d
            else:
                dist += d
                if dt and dt <= 30 and d / dt > 0.5:
                    moving += dt
                if p[3] is not None and prev[3] is not None and p[3] > prev[3]:
                    gain += p[3] - prev[3]
        prev = p
    gps_distance = dist
    if session.get("distance"):
        dist = float(session["distance"])
        if session.get("timer"):
            moving = float(session["timer"])
    hrs = [p[4] for p in pts if p[4]]
    cads = [p[5] for p in pts if p[5]]
    start = min(times) if times else None
    if start and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    lon0 = geo[0][1] if geo else None
    return {
        "id": stem,
        "file": path.name,
        "name": name,
        "type": ALIASES.get(kind, kind) or "unknown",
        "start_utc": start.isoformat() if start else None,
        "approx_local_hour": round(((start.hour + start.minute / 60 + (lon0 or 0) / 15) % 24), 2) if start else None,
        "distance_m": round(dist, 1),
        "skipped_m": round(skipped, 1),
        "gps_distance_m": round(gps_distance, 1),
        "source": "watch" if session.get("distance") else "gps",
        "moving_s": round(moving),
        "elapsed_s": round((max(times) - min(times)).total_seconds()) if len(times) > 1 else 0,
        "elev_gain_m": round(gain, 1),
        "hr_avg": round(sum(hrs) / len(hrs), 1) if hrs else None,
        "hr_max": max(hrs) if hrs else None,
        "cad_avg": round(sum(cads) / len(cads), 1) if cads else None,
        "start_area": [round(geo[0][0], 2), round(geo[0][1], 2)] if geo else None,
        "points": len(pts),
    }


if __name__ == "__main__":
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(p for p in src.iterdir() if re.search(r"\.(gpx|fit)(\.gz)?$", p.name))
    with Pool() as pool:
        rows = pool.map(summarize, files, chunksize=8)
    rows.sort(key=lambda r: r.get("start_utc") or "")
    out.write_text(json.dumps(rows, indent=1))
    print(len(rows), "activities;", sum("error" in r for r in rows), "errors")
