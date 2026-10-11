# Atlas

Static map at `/atlas/`. Serve with `python -m http.server 8765 --directory atlas`.

One persistent Leaflet map supports scroll zoom, dragging, touch gestures, and animated navigation. Only the confirmed visited countries and US home are selectable. China is scoped to Hong Kong. Markers make Hong Kong and Vatican City accessible on the world map. The World map button zooms back out.

Routes, city markers, and future photo pins belong on the map. There are no splash sections, itineraries, country lists, side panels, or example activity records. All visits to a country appear together. Activity data is in `data/activities.json`; city locations are in `data.js`. France, Italy, and Switzerland open their own maps. TMB gets a shared route view only when actual exports are present. No Strava links are included.

Country and state boundaries, visited places, recorded activity tracks, and transport paths are packaged locally. The plain Esri street basemap supplies major roads, other cities, lakes, and rivers over the network. Country selection uses local geometry and an animated camera. France highlights metropolitan France only, with overseas territory drawn as unvisited. Hong Kong SAR uses its own geometry. Leaflet and TopoJSON retain their upstream license headers in `vendor/`.

## Imported activity data

The Netherlands ride is from the user-provided `11393102827.gpx`: May 12, 2024, 11,214 GPS points, Amsterdam to Utrecht. The five named places are user-confirmed visits, with place-center markers; they are not linked by an invented travel route.

Distance is calculated from consecutive GPS points within each recorded segment. Elapsed time comes from track timestamps. Ascent is an estimate from positive altitude changes, shown with an approximate sign. These are GPX calculations, not official Strava statistics.

Import another GPX with `python atlas/scripts/import_gpx.py TRACK.gpx --journey netherlands --name "Amsterdam ride" --countries 528 --timezone Europe/Amsterdam`. Existing activity IDs are replaced on reimport. GPX track gaps remain separate segments.

TMB exports can use `--journey tmb --name "Tour du Mont Blanc" --countries 250,380,756 --timezone Europe/Paris`. TMB imports are checked against the Mont Blanc area. Routes show together by default and can be selected directly on the map.

When changing the app or data, advance the asset version in `index.html` so GitHub Pages caches cannot mix old code with new markup or activity data.

The optional Natural Earth context dataset, retained for a future local vector basemap, is built with `python atlas/scripts/build_context.py SOURCE_DIRECTORY` from the Natural Earth GitHub GeoJSON files `ne_10m_roads`, `ne_50m_lakes`, `ne_50m_rivers_lake_centerlines`, and `ne_50m_populated_places`. Roads cover the visited regions and nearby European transit areas. These generalized features provide context, rather than street-level navigation.

Transport connections in `data/transport.json` retain ticket-backed dates/operators and user-confirmed stops. Train lines follow BRouter’s OpenStreetMap rail network; bus and driving lines follow OSRM’s OpenStreetMap roads. Their colors distinguish train, bus, drive, hike, and bike. The 33 transport paths are bundled, so viewing them never calls a routing service. Recorded GPS tracks are preserved separately in `data/activities.json`. Public data excludes personal addresses, email identifiers, booking references, payment details, and airport-only layovers. No travel order is invented for the US city list. Rebuild transport paths with `python atlas/scripts/build_transport_routes.py CACHE_DIRECTORY`; the cache avoids repeating successful routing requests. Endpoint platform pins and selected rail waypoints prevent snapping to disconnected tram tracks. The Iceland driving endpoint is the canyon’s road access point.

Map details use Esri World Street Map at every zoom, with cities, roads and water and no elevation layer. Country shading fades continuously between zoom levels 2.5 and 5. Wheel, trackpad, and zoom buttons interpolate a fractional camera; touch pinch does not snap to fixed levels.

US boundaries are packaged from us-atlas (US Census geometry). All 50 states can be explored, with 22 user-confirmed visited states, their cities/areas, and 12 national parks in `US_VISITS`. These are independent place markers, without invented US travel connections. State shading fades into the same detail map as the camera zooms. Visited-city labels use screen-space collision detection and alternative placements, and clicking a city does not open a duplicate name popup. Giza is omitted at the user’s request.
