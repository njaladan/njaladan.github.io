# Atlas

Static map at `/atlas/`. Serve with `python -m http.server 8765 --directory atlas`.

One persistent Leaflet map supports scroll zoom, dragging, touch gestures, and animated navigation. Only the confirmed visited countries and US home are selectable. China is scoped to Hong Kong. Markers make Hong Kong and Vatican City accessible on the world map. The World map button zooms back out.

Routes, city markers, and future photo pins belong on the map. There are no splash sections, itineraries, country lists, side panels, or example activity records. All visits to a country appear together. Activity data is in `data/activities.json`; city locations are in `data.js`. TMB routes will appear across France, Italy, and Switzerland when the actual exports are available. No Strava links are included.

Natural Earth country geometry is packaged locally. Terrain tiles use Esri WorldTopoMap and require network access. Leaflet and TopoJSON retain their upstream license headers in `vendor/`.
