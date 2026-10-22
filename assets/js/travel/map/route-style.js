import { REGIONAL_ZOOM } from './constants.js';

// Route emphasis: the selected activity, hovered routes and itinerary hovers.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

// Invisible hit lines widen at regional zoom, where they would otherwise cover whole countries.
const HIT_WEIGHT = 6;
const REGIONAL_HIT_WEIGHT = 18;
const SELECTED = { outline: { weight: 6, opacity: 0.9 }, line: { weight: 3.5, opacity: 1 } };
const UNSELECTED = { outline: { weight: 4, opacity: 0.35 }, line: { weight: 2, opacity: 0.45 } };
const UNSELECTED_COLOR = '#8d999e';

/**
 * Hit-line weight for the current zoom.
 * @param {AtlasContext} ctx
 */
export const hitWeight = ctx =>
  ctx.map.getZoom() >= REGIONAL_ZOOM ? REGIONAL_HIT_WEIGHT : HIT_WEIGHT;

/**
 * Greys every activity but the selected one, which is raised above the rest.
 * @param {AtlasContext} ctx
 */
export function updateRouteStyles(ctx) {
  const { activeDay } = ctx.state;
  ctx.layers.tracks.forEach(({ id, color, outline, line }) => {
    const selected = activeDay === null || activeDay === id;
    const style = selected ? SELECTED : UNSELECTED;
    outline.setStyle(style.outline);
    line.setStyle({ color: selected ? color : UNSELECTED_COLOR, ...style.line });
    if (selected) {
      outline.bringToFront();
      line.bringToFront();
    }
  });
}

/**
 * Hovering a route or its badge lifts it and fades the rest.
 * @param {AtlasContext} ctx
 * @param {() => Element[]} elements
 * @param {boolean} on
 */
export function hoverRoute(ctx, elements, on) {
  ctx.map.getContainer().classList.toggle('route-hovering', on);
  elements().forEach(node => node?.classList.toggle('route-hot', on));
}

/**
 * Itinerary hovers reuse the map's own route hover: lift these, fade the rest.
 * @param {AtlasContext} ctx
 * @param {{ kind: string, id: string }[] | null} refs
 */
export function highlightRoutes(ctx, refs) {
  const { state } = ctx;
  state.hotRoutes.forEach(node => node?.classList.remove('itinerary-hot'));
  state.hotRoutes = (refs || []).flatMap(
    ref => ctx.layers.routeHover.get(`${ref.kind}:${ref.id}`)?.() || []
  );
  state.hotRoutes.forEach(node => node?.classList.add('itinerary-hot'));
  ctx.map.getContainer().classList.toggle('itinerary-hovering', state.hotRoutes.length > 0);
}
