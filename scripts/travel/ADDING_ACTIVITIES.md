# Adding a FIT file (and the legs around it) to the travel map

Use this checklist when a FIT file from a watch (Garmin, Coros, ...) comes in to go on
`/travel/`. Two commands do the work, and you can re-run either one without creating
duplicates:

- `scripts.travel.add_fit` reads the track and stats from the FIT file, snaps the line
  onto OpenStreetMap paths (Valhalla), and adds it to `activities.json`.
- `scripts.travel.add_route` draws a train, drive, bus, ferry or gondola leg (BRouter
  rail or OSRM driving) and adds it to `transport.json`.

**Don't create an itinerary trip unless the user asks for one.** Activities and routes
show on the map without one. If the user does want one, pass `--trip` to either command
to add the leg to a trip in `itineraries.json`. Legs are added in the order the commands
run, so run them in the order things happened (train out, hike, train back).

**Don't draw a transport leg on top of an existing one.** `add_route` prints how much of
the new line runs along existing routes. Pass `--skip-if-overlap 0.3` to write nothing
when that share is 30% or more, then tell the user what it overlapped. For example, a
Chicago → Dune Park South Shore train was left out because 41% of it ran along the
existing `chicago-nyc` line.

## 1. Setup (once per machine)

```sh
python -m pip install "fitdecode>=0.10,<1" "ruff==0.16.9"   # or: pip install --group scripts --group dev
npm install
```

Copy the upload somewhere outside the repository, such as a scratch directory. Source
exports are never committed.

## 2. Look up stop coordinates

Each transport leg needs `Name=lat,lon` for each stop. Nominatim is the quickest:

```sh
curl -s -A travel-map-importer \
  "https://nominatim.openstreetmap.org/search?format=json&limit=3&q=Dune+Park+station+Indiana"
```

(Overpass is blocked in the cloud sandbox; Nominatim, BRouter, OSRM and Valhalla work.)

## 3. Add the activity and legs

The Indiana Dunes hike (2026-11-14) was added with:

```sh
python -m scripts.travel.add_fit indiana_dunes_park.fit --name "Indiana Dunes" --country "United States"
```

A transport leg looks like this. This one was rejected for overlap, so it is not on the site:

```sh
python -m scripts.travel.add_route --mode Train --operator "South Shore Line" --country "United States" \
  --stop "Chicago=41.88455,-87.62345" --stop "Dune Park=41.64496,-87.06057" --skip-if-overlap 0.3
```

`add_fit` also takes a `.gpx` (or `.gpx.gz`) from a Strava export. GPX files carry no
recorded totals, so distance, time and climb are worked out from the track, smoothed
against GPS jitter. Their times are UTC: pass `--utc-offset` (for example `-7` for a
Pacific summer date) so the local date is right, and pass the Strava id with `--id`.
The 2022 Washington hikes and West Coast road trip stops were added this way:

```sh
python -m scripts.travel.add_fit export/activities/7347250887.gpx --id 7347250887 \
  --name "Lassen" --country "United States" --utc-offset -7
```

For a trip whose days have no dates (like `san-jose-seattle`), leave out `--trip` and
add the `{"activity": id, "name": ...}` leg by hand between the drive legs, because
`--trip` matches days by date.

Useful flags:

| Flag | Script | Effect |
| --- | --- | --- |
| `--country` | both | Country name from `COUNTRIES` in `trips.py`, or a 3-digit ISO numeric ID. Repeat for cross-border legs. |
| `--skip-if-overlap SHARE` | add_route | Write nothing if this share (0–1) of the line runs along an existing route. |
| `--trip` / `--trip-title` | both | Only when asked: trip to add the leg to; `--trip-title` is needed only when the trip is new. |
| `--day-title` | both | Day heading in the itinerary panel. |
| `--leg-name` | both | Leg label, if it should differ from the activity or route name. |
| `--date` | add_route | Which trip day (YYYY-MM-DD). `add_fit` takes the date from the file, in the watch's local time. |
| `--new-day` | add_route | Without `--date`, start a new day instead of adding to the last one. |
| `--via lat,lon` | add_route | Waypoint that steers the router onto the correct line. |
| `--straight` | add_route | Straight line between stops (ferries and gondolas always use one). |
| `--note` | add_route | Caveat shown with the route, for example "Approximate: ...". |
| `--id` | both | Override the generated id. Activities default to `fit-<UTC start>`; pass the Strava id if you know it. |
| `--journey` | add_fit | Journey bucket. Defaults to `<country>-activities` (for example `united-states-activities`). |
| `--type` | add_fit | Override the sport read from the file (hiking, walking, running, cycling). |
| `--utc-offset` | add_fit | GPX only: local time minus UTC, in hours. |
| `--no-match` | add_fit | Keep the raw GPS line and skip map matching. |
| `--cache DIR` | add_fit | Valhalla response cache (default `~/.cache/travel-valhalla`). |

`add_route` warns if the routed line ends more than 1 km from a stop. That usually means
the coordinates are wrong or a `--via` is needed.

## 4. If the outing is at a national park or in a new US state

Visited US states, their cities and their national parks are listed in `US_VISITS` in
`assets/js/travel/shared/data.js`, keyed by state FIPS code. Add the park there, for
example `'18': { name: 'Indiana', cities: [], parks: [['Indiana Dunes', 41.6533, -87.0524]] }`.
Places in other countries go in `COUNTRY_PLACES` in the same file.

## 5. Check, look and ship

```sh
npm run format          # the importers' output must be Prettier-formatted
npm run check           # ESLint, Prettier, tsc, tests, Ruff and a Jekyll build
```

The importers only add or replace the entries they touch, so `git diff --stat` should
show insertions only, unless you are re-importing something.

To look at the result, run `npm run serve` and open
`/travel/?lat=<lat>&lng=<lon>&zoom=11` (and the trip under **Itineraries**, if you made one). If
`bundle exec jekyll` reports "command not found" in the cloud sandbox, run
`/opt/rbenv/versions/3.3.6/bin/jekyll serve` instead.

Then commit and push to `master`, following `AGENTS.md`.
