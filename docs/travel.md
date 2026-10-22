# Travel

The travel atlas is served at `/travel/` from `_pages/travel.html`; the photo
gallery at `/photos/` (`assets/js/photos.js`) reads the same photo manifest.
The atlas's code, styles, data and photos live in `assets/travel/`, and paths below
are relative to it unless they start with `_` or `scripts/`. Build or serve from the
repository root with Jekyll so the shared site header renders.

## Globe and flat views

The atlas opens as a globe. The **Projection** setting switches to the flat Mercator Leaflet
map; the choice is saved locally (`atlas-map-view`) and the page reloads into it,
keeping the URL hash. Browsers without WebGL get the flat map and a disabled
globe option. Both views run **the same application**:
`_includes/travel-app-head.html` and `travel-map-ui.html` load the same scripts,
styles, controls and viewer. `app.js` owns visits, states, cities,
airports and connection lists, activity/transport/flight cards, route animation,
URL navigation, settings, legends and itineraries. `photos.js` owns clustering,
magnetic splits/merges, progressive images, preview/fullscreen transitions and
photo gestures in both views. Asset paths resolve from `runtime.js`, independent
of the page URL.

`renderers/globe.js` adapts that application's layer and camera contract to
locally vendored MapLibre GL JS 5.6.1 (BSD license retained in
`vendor/LICENSE-maplibre.txt`) and sets `window.ATLAS_RENDERER`, which `app.js`
uses in place of Leaflet. Leaflet supplies shared geometry utilities and
layer base classes; MapLibre owns the single camera and rendering surface.
The adapter handles projection, backside culling, DOM/SVG overlays, geographic
fills, detail tiles and popup placement. It adds no trip, photo or card logic.

The projection interpolates from globe at native zoom 3 to Mercator at zoom 6.
Close views use the same Esri detail tiles and all views use the main map's
palette. `renderers/globe-flights.js` draws elevated great-circle ribbons with
an independent sphere depth pass, keeping front-face flights visible and hiding
the far side. The arcs flatten as zoom increases and share the original flight
cards and hover behavior. Heights illustrate connections, not recorded cruising
altitudes. Camera flights and 3D arc animation respect reduced motion. Ground
routes share the original map's directional dash animation.

## Files and data

- `app.js`, `data.js`, `basemap-labels.js`, and `smooth-zoom.js` render the map,
  visited places, labels, routes, and camera controls.
- `photos.js` and `photo-zoom.js` handle map photo collections and the viewer.
- `map-ui.css` and `_includes/travel-photo-viewer.html` are shared by both map views.
- `route-cards.js` builds the popup card shared by activities, transport, flights,
  and airports, plus route badges. Activity titles name the sport and nearest
  mapped place; a non-default Strava name appears as a quote. Only the treks in
  `app.js`'s `TREKS` step day to day.
- `itineraries.js`, `itineraries.css`, and `data/itineraries.json` group trips
  into days of ordered legs that link to existing activity and transport IDs.
  The **Itineraries** map button opens a side panel listing the trips; choosing
  one flies to the whole trip beside the panel. **View full itinerary** on a
  trip card replaces the card with the panel. Hovering a day or leg lifts its
  routes on the map; selecting a day zooms to it. Each day shows photos taken
  that day (dated photos) or along its routes (undated). Route cards in a trip
  only name their day and link to the panel, which handles all navigation.
  `scripts/travel/build_tmb_routes.py`, `scripts/travel/build_iceland_routes.py` and
  `scripts/travel/import_estimated_drives.py` regenerate the trip transfers.
- `data/world.json`, `data/us-states.json`, and `data/context.json` provide local
  country/state outlines and high-level Natural Earth city labels. Esri Light
  Gray tiles provide street detail when online; the overview and overlays work
  without them. Keep the Leaflet and TopoJSON license headers in `vendor/`.
- `data/activities.json` contains recorded GPS tracks and export statistics.
- `data/transport.json` contains all saved train, bus, drive, ferry, and gondola routes,
  including their stops and source notes. Edit ferry definitions here directly.
- `data/flights.json` contains flight records, approximate great-circle paths,
  and the airport coordinate catalog from [OurAirports](https://ourairports.com/data/).
- `data/photos.json` contains photo assets, gallery text/order, coordinates, and
  location evidence. `source_filename` and `location_tag` retain the original
  filenames, confidence, coordinate scope, and evidence for inferred locations.

Visit claims come from confirmed places, not basemap labels or airport layovers.
China is scoped to Hong Kong; France uses metropolitan geometry. All visits to a
country appear together. Route dashes follow coordinate order; shared flight
connections use the first recorded flight's direction. Estimated road and ferry
paths retain their source notes and are not vessel or activity GPS recordings.
Keep uploaded exports, personal addresses, and booking/payment details out of the
public repository.

The map's gear button opens settings for photo pins and distance units. Photo
pins are shown by default; turning them off prevents pin thumbnails from loading.
The photo preference is saved locally. Kilometers are the default distance unit; the
miles preference is saved locally and applies to activity, transport, and flight
cards, including an open card. Activity elevation stays in meters.

Bus cards show the route, operator, distance, bus journey time, and nearby photos.
Outbound and return journeys use compact direction/operator/time rows. Badges,
service numbers, terminal details, tour logistics, stop/country counts, and
approximation markers are omitted. Journey time uses the saved duration; full-tour
duration is not shown as bus time. The optional `bus` object retains the supporting
service details in `data/transport.json`; `duration_approximate` records a rounded
timetable value, and `return_service` holds the return direction. The mapped road
geometry remains the saved outward route. The estimated-road importer preserves
`bus` and operator metadata. Keep ticket IDs, passenger information, and private
email links out of the manifest.

## Photos

```sh
python -m pip install -r requirements.txt
python scripts/travel/import_photo.py /path/to/photo.jpg \
  --id louvre-pyramid --place "Louvre · Paris" \
  --lat 48.8606 --lon 2.3358 --country 250 --caption "The Louvre Pyramid"
```

Set coordinates explicitly. Optional `--date YYYY-MM-DD` records a confirmed date;
never invent one. Reusing an ID replaces that photo without duplicating it.
The importer creates oriented, sRGB display derivatives without metadata or upscaling;
it does not store the source file, so keep originals outside the repo. HEIC input needs
`pillow-heif` from `requirements.txt`.

Set each photo's `gallery.subject` and `gallery.location` in sentence case with
proper names capitalized. These fields supply the names on both the map and gallery;
keep `place` equal to `subject — location` for compatibility. Photos without gallery
metadata use `place`. Keep optional descriptive text in `caption`.
`gallery_order` lists IDs to show first; remaining photos
sort by date and ID. Dates are not displayed in the gallery or map viewer. Keep
location evidence in the manifest rather than maintaining separate mapping reports.

## Activities and routes

```sh
python scripts/travel/import_strava.py EXPORT_DIRECTORY REVIEW.json
python scripts/travel/import_gpx.py TRACK.gpx --journey netherlands \
  --name "Amsterdam ride" --countries 528
python scripts/travel/match_activities.py CACHE_DIRECTORY
python scripts/travel/import_flights.py PATH_TO_FLIGHTS.csv
python scripts/travel/build_transport_routes.py CACHE_DIRECTORY
python scripts/travel/build_iceland_routes.py CACHE_DIRECTORY
python scripts/travel/import_estimated_drives.py CACHE_DIRECTORY
python scripts/travel/build_context.py SOURCE_DIRECTORY
```

The Strava review manifest selects activities by `Activity ID`, `Filename`, and
`countries`. FIT input requires `fitdecode`. Imports preserve GPS gaps, use CSV
statistics, crop FIT tracks to the published interval, and simplify display geometry
within 3 meters. Existing IDs are skipped unless `--replace` is supplied; entries
marked `already_imported` remain protected. GPX reimports replace matching IDs;
`--journey tmb --countries 250,380,756` validates tracks against the Mont Blanc area.
After importing, `match_activities.py` thins GPS jitter and snaps new walks, hikes and
rides onto OpenStreetMap paths with Valhalla; stretches off the map keep the GPS line,
smoothed. Already matched tracks are skipped unless `--force` is supplied.

Before importing flights with new airports, add their coordinates and labels to
`data/flights.json`'s `airports` catalog. Flight imports preserve that catalog.
Transport builders save OpenStreetMap road/rail geometry locally and cache routing
responses. The main builder preserves existing ferry definitions and rebuilds the
Iceland road legs against recorded hike endpoints. The estimated-drive importer
replaces its own route IDs. Context rebuilding expects
`ne_50m_populated_places.geojson` in the source directory.

Asset and map JSON URLs reuse the build timestamp, so there are no versions to bump.

## JSON formatting

Data files in `assets/travel/data/` are kept pretty-printed in git. Importers such as
`match_activities.py` write compact JSON, so run `npm run format` after them (CI runs
`format:check`). Production builds minify every `.json` file in `_site/` through
`_plugins/minify_json.rb`, so visitors get the compact versions.
