# Vendored libraries

Unmodified release builds, served as classic scripts before the site's modules
(see `types/globals.d.ts` for the globals they define). To upgrade one, replace
its files with the new release's `dist/` build and update this table.

| Files                               | Library                                                        | Version | License                                                      |
| ----------------------------------- | -------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `leaflet.js`, `leaflet.css`         | [Leaflet](https://github.com/Leaflet/Leaflet)                  | 1.9.4   | BSD-2-Clause, [`LICENSE-leaflet.txt`](LICENSE-leaflet.txt)   |
| `maplibre-gl.js`, `maplibre-gl.css` | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js)   | 5.6.1   | BSD-3-Clause, [`LICENSE-maplibre.txt`](LICENSE-maplibre.txt) |
| `topojson.min.js`                   | [topojson-client](https://github.com/topojson/topojson-client) | 3.1.0   | ISC, [`LICENSE-topojson.txt`](LICENSE-topojson.txt)          |

Each file matches the package's `dist/` build on npm byte for byte, e.g.
`https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`.
