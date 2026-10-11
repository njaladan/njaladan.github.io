# Field Notes — adventure atlas mockup

A buildless, static prototype for Ganesh's personal travel journal. Serve `dist/` with any static HTTP server. There is no backend, account system, or live Strava integration.

## Experience

- Select any of 241 country and territory geometries from the world map or search.
- Chile, France, Italy, Switzerland, and the US contain labeled example journeys.
- Countries combine all example visits by default. The visit selector can isolate one visit.
- Country maps show travel routes, cities, photo pins, and run/hike tracks. Layer toggles are independent.
- Selecting a stop or activity focuses its map location; photos open a lightbox and can be located on the map.
- TMB remains one cross-border journey under France, Italy, and Switzerland.
- Mobile layout places the map before the journal for convenient exploration.

All itinerary groupings, stats, routes, and photo locations are illustrative. Photos are stock imagery, not personal images. `dist/data.js` contains the sample data; actual Strava exports and geotagged photos can replace it later. Terrain tiles need network access; geographic world data, routes, pins, and photos are packaged locally. Fonts use Google Fonts, with system fallbacks.
