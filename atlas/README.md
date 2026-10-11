# Field Notes — adventure atlas mockup

A buildless, static prototype for Ganesh's personal travel journal. Serve `atlas/` with any static HTTP server. There is no backend, account system, or live Strava integration.

## Experience

- Select any of 241 country and territory geometries from the world map or search.
- Highlight the user's confirmed 23-country list, including Austria. The US is displayed separately as home. China is explicitly scoped to the Hong Kong visit, and that entry zooms to Hong Kong.
- The visited-country index makes small countries such as Vatican City accessible without precise map clicking.
- Chile, France, Italy, Switzerland, and the US contain labeled example journeys.
- Countries combine all example visits by default. The visit selector can isolate one visit.
- Country maps show travel routes, cities, photo pins, and run/hike tracks. Layer toggles are independent.
- Selecting a stop or activity focuses its map location; photos open a lightbox and can be located on the map.
- TMB remains one cross-border journey under France, Italy, and Switzerland.
- Mobile layout places the map before the journal for convenient exploration.

The visited-country list is real, supplied by the user. All itinerary groupings, stats, routes, and photo locations are illustrative. Photos are stock imagery, not personal images. `data.js` contains the country list and sample data; actual Strava exports and geotagged photos can replace the samples later. Terrain tiles need network access; geographic world data, routes, pins, and photos are packaged locally. Fonts use Google Fonts, with system fallbacks.

## Preview from this repository

Run `python -m http.server 8765 --directory atlas` from the repository root, then open `http://localhost:8765/`. The mockup lives entirely in `atlas/`; the existing homepage, reading list, and layouts are unchanged.
