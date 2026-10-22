const js = require('@eslint/js');
const globals = require('globals');

// The site's scripts are plain browser scripts loaded in order with <script defer>,
// so files share top-level declarations instead of importing them.
const shared = {
  // travel/data.js
  COUNTRY_PLACES: 'readonly',
  HOME_COUNTRY: 'readonly',
  ROUTE_MODES: 'readonly',
  US_VISITS: 'readonly',
  VISITED_COUNTRIES: 'readonly',
  // travel/runtime.js
  escapeHtml: 'readonly',
  travelAsset: 'readonly',
  // travel/*.js installers
  createGlobeFlights: 'readonly',
  installAtlasPhotos: 'readonly',
  installBasemapLabels: 'readonly',
  installPhotoZoom: 'readonly',
  installRouteCards: 'readonly',
  installSmoothZoom: 'readonly',
  installTripItineraries: 'readonly',
  // travel/vendor
  L: 'readonly',
  maplibregl: 'readonly',
  topojson: 'readonly'
};

module.exports = [
  { ignores: ['_site/', 'node_modules/', 'travel/vendor/', 'athletics/shapes.js', 'codequeue/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, ...shared }
    },
    rules: {
      // Top-level declarations are how scripts share code with each other.
      'no-unused-vars': ['error', { vars: 'local', caughtErrors: 'none' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
      // Storage access can throw in private windows; those failures are ignored.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  }
];
