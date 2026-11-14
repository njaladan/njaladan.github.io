"""Shared helpers for the one-shot travel importers (add_fit, add_route).

They read and write the travel map's JSON documents and append legs to trip
itineraries, so an outing can be built up one command at a time.
"""

import json
import re

from scripts.common.paths import TRAVEL_DATA

ACTIVITIES = TRAVEL_DATA / "activities.json"
TRANSPORT = TRAVEL_DATA / "transport.json"
ITINERARIES = TRAVEL_DATA / "itineraries.json"

# Country name → (ISO 3166 numeric ID used by the map, slug for "<slug>-activities" journeys).
COUNTRIES = {
    "United States": ("840", "united-states"),
    "United Kingdom": ("826", "united-kingdom"),
    "France": ("250", "france"),
    "Norway": ("578", "norway"),
    "Netherlands": ("528", "netherlands"),
    "Switzerland": ("756", "switzerland"),
    "Italy": ("380", "italy"),
    "Morocco": ("504", "morocco"),
    "Spain": ("724", "spain"),
    "Canada": ("124", "canada"),
    "Hong Kong S.A.R.": ("156", "hong-kong"),
    "Iceland": ("352", "iceland"),
    "Turkey": ("792", "turkey"),
    "Chile": ("152", "chile"),
    "Japan": ("392", "japan"),
    "India": ("356", "india"),
    "Jordan": ("400", "jordan"),
    "Austria": ("040", "austria"),
    "Czechia": ("203", "czechia"),
}


def country_ids(values):
    """Accept country names from COUNTRIES or numeric IDs; return numeric IDs."""
    ids = []
    for value in values:
        if value in COUNTRIES:
            ids.append(COUNTRIES[value][0])
        elif re.fullmatch(r"\d{3}", value):
            ids.append(value)
        else:
            raise SystemExit(f"Unknown country {value!r}: use a name from trips.COUNTRIES or a 3-digit ISO numeric ID")
    return ids


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def load(path, empty):
    return json.loads(path.read_text()) if path.exists() else empty


def _item_spans(text, key):
    """Original source text of each item in the document's top-level `key` array."""
    decoder = json.JSONDecoder()
    match = re.search(rf'"{key}"\s*:\s*\[', text)
    if not match:
        return []
    spans, index = [], match.end()
    while True:
        index = re.compile(r"[\s,]*").match(text, index).end()
        if text[index] == "]":
            return spans
        value, end = decoder.raw_decode(text, index)
        spans.append((value, text[index:end]))
        index = end


def save(path, document):
    """Write `document` ({key: [items]}) without restyling entries that did not change.

    The data files mix inline and expanded objects, which Prettier preserves but cannot
    recreate, so unchanged top-level items keep their original text verbatim and only new
    or edited items are serialized (indented, so Prettier keeps them readable). Run
    `npm run format` afterwards.
    """
    (key, items), *rest = document.items()
    if rest:
        raise ValueError(f"{path.name}: expected a single top-level key")
    text = path.read_text() if path.exists() else ""
    escaped = "\\u" in text
    originals = {json.dumps(value, sort_keys=True): source for value, source in _item_spans(text, key)}
    parts = []
    for item in items:
        source = originals.get(json.dumps(item, sort_keys=True))
        if source is None:
            source = json.dumps(item, indent=2, ensure_ascii=escaped).replace("\n", "\n    ")
        parts.append("    " + source)
    body = ",\n".join(parts)
    path.write_text(f'{{\n  "{key}": [\n{body}\n  ]\n}}\n' if parts else f'{{\n  "{key}": []\n}}\n')


def add_leg(trip_id, leg, *, trip_title=None, date=None, day_title=None, new_day=False, hiking=False):
    """Append `leg` ({"activity": id} or {"route": id}, optional "name") to a trip day.

    The day is the one with `date` (created if missing); without a date, the last
    day unless `new_day`. Re-running with the same leg updates it in place, so the
    importers are safe to repeat. Legs keep the order the commands were run in.
    """
    if not re.fullmatch(r"[a-z0-9-]+", trip_id):
        raise SystemExit(f"Trip id {trip_id!r} must be lowercase letters, digits and hyphens")
    document = load(ITINERARIES, {"trips": []})
    trip = next((t for t in document["trips"] if t["id"] == trip_id), None)
    if trip is None:
        if not trip_title:
            raise SystemExit(f"Trip {trip_id!r} does not exist yet; pass --trip-title to create it")
        trip = {"id": trip_id, "title": trip_title, "days": []}
        document["trips"].append(trip)
    elif trip_title:
        trip["title"] = trip_title
    if hiking:
        # Hiking trips frame the trail rather than the transfer to it.
        trip = _with_fit_first(document, trip)
    key = "activity" if "activity" in leg else "route"
    for existing_day in trip["days"]:
        existing_day["legs"] = [item for item in existing_day.get("legs", []) if item.get(key) != leg[key]]
    day = None
    if date:
        day = next((d for d in trip["days"] if d.get("date") == date), None)
    elif trip["days"] and not new_day:
        day = trip["days"][-1]
    if day is None:
        day = {"date": date} if date else {}
        day["title"] = day_title or ""
        day["legs"] = []
        trip["days"].append(day)
        trip["days"].sort(key=lambda d: d.get("date") or "9999")
    if day_title:
        day["title"] = day_title
    day["legs"].append(leg)
    save(ITINERARIES, document)
    position = trip["days"].index(day) + 1
    print(f"Trip {trip_id}: day {position} ({day.get('date') or 'undated'}) now has {len(day['legs'])} legs")


def _with_fit_first(document, trip):
    if trip.get("fit") == "activities":
        return trip
    ordered = {"id": trip["id"], "fit": "activities", **{k: v for k, v in trip.items() if k != "id"}}
    document["trips"][document["trips"].index(trip)] = ordered
    return ordered
