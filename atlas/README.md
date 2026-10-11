# Atlas

Static map at `/atlas/`. Serve with `python -m http.server 8765 --directory atlas`.

One persistent Leaflet map supports scroll zoom, dragging, touch gestures, and animated navigation. Only the confirmed visited countries and US home are selectable. China is scoped to Hong Kong. Markers make Hong Kong and Vatican City accessible on the world map. The World map button zooms back out.

Routes, city markers, and future photo pins belong on the map. There are no splash sections, itineraries, country lists, side panels, or example activity records. All visits to a country appear together. Activity data is in `data/activities.json`; city locations are in `data.js`. France, Italy, and Switzerland open their own maps. TMB gets a shared route view only when actual exports are present. No Strava links are included.

Country and state boundaries, visited places, recorded activity tracks, and transport paths are packaged locally. The plain Esri street basemap supplies major roads, other cities, lakes, and rivers over the network. Country selection uses local geometry and an animated camera. France highlights metropolitan France only, with overseas territory drawn as unvisited. Hong Kong SAR uses its own geometry. Leaflet and TopoJSON retain their upstream license headers in `vendor/`.

## Imported activity data

The Netherlands ride is from the user-provided `11393102827.gpx`: May 12, 2024, 11,214 GPS points, Amsterdam to Utrecht. The five named places are user-confirmed visits, with place-center markers; they are not linked by an invented travel route.

The reviewed local Strava export adds 59 international activities, for 60 recorded activities across 13 countries/regions. Original titles, local dates, activity types, distance, elapsed time, and ascent are retained. The seven TMB recordings include both parts of day six; two additional Bourg-Saint-Maurice walks stay separate. Records without GPS are excluded. Existing Amsterdam data is preserved without duplication.

Import a reviewed JSON manifest with `python atlas/scripts/import_strava.py EXPORT_DIRECTORY REVIEW.json` (FIT input requires `fitdecode`). Manifest entries select activities by `Activity ID` and retain the reviewed `Filename`, `date`, and `countries`. Strava CSV IDs are authoritative even when original FIT filenames have different IDs. FIT tracks are cropped to the CSV activity start and elapsed interval, since original files can include driving removed from the published hike. Track segments retain gaps; display geometry is simplified within 3 meters with segment endpoints preserved. Export statistics are not recalculated from the simplified geometry. Reimports skip existing activity IDs by default; `--replace` refreshes newly reviewed tracks while preserving activities marked `already_imported`.

For the original GPX importer, distance is calculated from consecutive GPS points within each recorded segment, elapsed time comes from track timestamps, and ascent is an estimate from positive altitude changes, shown with an approximate sign. New bulk imports use the statistics from the Strava CSV instead.

Import another GPX with `python atlas/scripts/import_gpx.py TRACK.gpx --journey netherlands --name "Amsterdam ride" --countries 528 --timezone Europe/Amsterdam`. Existing activity IDs are replaced on reimport. GPX track gaps remain separate segments.

TMB exports can use `--journey tmb --name "Tour du Mont Blanc" --countries 250,380,756 --timezone Europe/Paris`. TMB imports are checked against the Mont Blanc area. Routes show together by default and can be selected directly on the map.

When changing the app or data, advance the asset version in `index.html` so GitHub Pages caches cannot mix old code with new markup or activity data.

The optional Natural Earth context dataset, retained for a future local vector basemap, is built with `python atlas/scripts/build_context.py SOURCE_DIRECTORY` from the Natural Earth GitHub GeoJSON files `ne_10m_roads`, `ne_50m_lakes`, `ne_50m_rivers_lake_centerlines`, and `ne_50m_populated_places`. Roads cover the visited regions and nearby European transit areas. These generalized features provide context, rather than street-level navigation.

Transport connections in `data/transport.json` retain ticket-backed dates/operators and user-confirmed stops. Train lines follow BRouter’s OpenStreetMap rail network; bus and driving lines follow OSRM’s OpenStreetMap roads. Their colors distinguish train, bus, drive, hike, and bike. The 38 transport paths are bundled, so viewing them never calls a routing service. Recorded GPS tracks are preserved separately in `data/activities.json`. Public data excludes personal addresses, email identifiers, booking references, payment details, and airport-only layovers. No travel order is invented for the US city list. Rebuild transport paths with `python atlas/scripts/build_transport_routes.py CACHE_DIRECTORY`; the cache avoids repeating successful routing requests. Endpoint platform pins and selected rail waypoints prevent snapping to disconnected tram tracks. The Iceland driving endpoint is the canyon’s road access point.

Five driving paths reconstruct the August 2026 Jordan and Tunisia trips at the user's request. They use dashed Drive lines and popup notes identifying them as estimates, with road geometry rather than GPS recordings. Jordan's order is Aqaba → Wadi Rum → Wadi Musa (Petra) → Amman, based on arrival, tour, and hotel records for August 25–28. The Petra driving legs stop in Wadi Musa rather than tracing roads through the archaeological site. No unverified Dead Sea, Jerash, or desert jeep excursions are added.

Tunisia's August 30–31 tour uses the booked Tunis-airport pickup/return and a [published itinerary matching the booked tour title](https://www.kkday.com/en/product/806296). Day 1 runs through Kairouan, Matmata, and Tamezret to Ksar Ghilane; Day 2 returns through Tataouine, Chenini, Ksar Haddada, and El Jem. These intermediate stops and their order are itinerary-based estimates, not independently confirmed visits. Existing city markers are preserved. Rebuild just these routes with `python atlas/scripts/import_estimated_drives.py CACHE_DIRECTORY`; rerunning replaces the same route IDs without duplicating them.

Map details use Esri World Street Map at every zoom, with cities, roads and water and no elevation layer. Country shading fades continuously between zoom levels 2.5 and 5. Wheel, trackpad, and zoom buttons interpolate a fractional camera; touch pinch does not snap to fixed levels.

## Flights

The user-provided `flights.csv` contains 122 flights from January 9, 2021 through September 17, 2026, across 63 airports. `data/flights.json` preserves each flight's date, number, direction, logged duration, and airline when supplied. The 86 airport pairs group repeated flights in scrollable popups. The Flights button toggles the overlay; airport markers appear as the map zooms in. Airport arrivals/departures do not add city, state, or country visit claims.

Dashed blue lines are approximate great-circle connections, not recorded flight paths. Dateline crossings are split to avoid drawing lines across the map. Airport coordinates come from the public-domain OurAirports dataset, with the 63 required entries saved in `data/airports.json`. No airport lookup or routing service is called by the browser. Reimport with `python atlas/scripts/import_flights.py PATH_TO_FLIGHTS.csv`; add coordinates to `data/airports.json` first when an export introduces a new airport. The uploaded CSV stays outside the public repository; seat numbers, registrations, notes, and internal export IDs are not published.

US boundaries are packaged from us-atlas (US Census geometry). All 50 states can be explored, with 22 user-confirmed visited states, their cities/areas, and 12 national parks in `US_VISITS`. These are independent place markers, without invented US travel connections. State shading fades into the same detail map as the camera zooms. Visited-city labels use screen-space collision detection and alternative placements, and clicking a city does not open a duplicate name popup. Giza is omitted at the user’s request.
