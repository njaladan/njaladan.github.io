// Values shared by several atlas modules. Values used by one module live there.

/** Fallback route colors for activity types without a mode color. */
export const ROUTE_COLORS = [
  '#b7774a',
  '#4f7e8a',
  '#807398',
  '#859650',
  '#bd825e',
  '#62739d',
  '#a26780'
];
export const VISIT_COLORS = { visited: '#c79572', home: '#829e94' };
/** Transport legs whose mode has no color of its own. */
export const TRANSPORT_COLOR = '#697c84';

/** The world view leaves out Antarctica and the far Arctic. */
export const WORLD_BOUNDS = [
  [-58, -178],
  [80, 178]
];
export const WORLD_PADDING = [15, 15];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 17;
/** Default zoom for a ?lat=&lng= deep link without &zoom=. */
export const DEEP_LINK_ZOOM = 13;
// Route badges, wide hit lines and airport codes appear from this zoom on.
export const REGIONAL_ZOOM = 6.5;
// Airport badges appear from this zoom on.
export const AIRPORT_ZOOM = 4.5;
export const PHONE_QUERY = '(max-width: 600px)';

/** Leaflet popup options shared by every route card. */
export const CARD_OPTIONS = {
  className: 'route-card-popup',
  maxWidth: 320,
  minWidth: 300,
  autoPanPaddingTopLeft: [20, 70],
  autoPanPaddingBottomRight: [20, 20]
};
