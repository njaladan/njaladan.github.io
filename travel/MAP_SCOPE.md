# Scope: a self-contained travel atlas basemap

Build the basemap from packaged geographic data, with one continuously zoomable camera and the existing visited places, states, GPS tracks, and transport paths above it. This removes third-party tile requests, API keys, provider warning tiles, and dependence on a provider's label styling.

## Recommended first version

- Land, ocean, country boundaries, and US states.
- Major cities, with visited places taking priority in label placement.
- Major lakes and rivers, and primary roads.
- Smooth pan, wheel/trackpad zoom, pinch zoom, and navigation to a country/state.
- Country/state visit coloring that gradually fades as detail becomes visible.
- Constant-size markers, readable route colors, and labels that avoid collisions.
- Existing route popups and recorded GPS tracks preserved.

Use Natural Earth for global geography and major features, US Census geometry for state outlines, and OpenStreetMap-derived regional data where more road or water detail is needed. Keep attribution for each source. Owning the presentation does not require creating geographic data from scratch.

## Architecture

Retain Leaflet for camera projection, pan/zoom input, accessibility, and popups. Replace raster tile layers with a local Canvas or SVG basemap layer. Keep visited places and journey overlays separate so the basemap can change without changing the travel records.

Produce simplified geometry at several scales. Bundle world-scale features; load country/region detail from the same static site when needed. Cache it locally and clip rendering to the visible area. Country coloring, water/road detail, and labels should depend on camera scale, with no separate map views or sudden switch.

Use the existing label collision logic, with visited places ahead of background cities. Do not derive visit claims or journeys from the background dataset. The current transport paths remain bundled; the browser does not need to call a routing service.

## Work to budget for

1. A working prototype with world/country outlines, water, main roads, and visited overlays, using the Netherlands, Switzerland/Italy, Iceland, and the US as representative regions.
2. A consistent visual style, scale-dependent detail, and label priorities.
3. Mobile pinch/drag checks, performance checks on dense regions, and offline/provider-failure checks.
4. Replace the tile layer after the prototype meets the same interaction and route requirements as the current map.

This is a moderate map-rendering project when an existing camera library is retained. Writing projection math, touch gestures, inertia, zoom anchoring, and popup positioning from scratch adds substantial work without improving the travel presentation.

## Detail boundary

Global major-city, major-road, lake, and river coverage fits this approach. Every small pond, stream, local street, building, and trail at unlimited zoom would need much larger datasets and a more elaborate data/rendering pipeline. Start with an atlas-level map and detailed data for visited regions; measure payload size and performance in the prototype before committing to broader high-resolution coverage.
