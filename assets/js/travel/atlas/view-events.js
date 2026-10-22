import { updateBasemap } from './camera.js';
import { declutterLabels, queueLabelLayout } from './labels.js';
import {
  cancelRouteAnimations,
  queueRouteAnimations,
  updateBadges,
  updateRouteAnimations,
  updateRouteLegend
} from './routes.js';
import { applyHash } from './router.js';

// Keeps the basemap, labels, legend and route animations in step with the camera.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

/**
 * @param {AtlasContext} ctx
 */
function installMoveEvents(ctx) {
  const { map, state } = ctx;
  map.on('movestart', () => {
    state.cameraMoving = true;
    cancelRouteAnimations(ctx);
    map.getContainer().classList.add('map-moving');
  });
  map.on('move', () => queueLabelLayout(ctx));
  map.on('moveend', () => {
    state.cameraMoving = false;
    clearTimeout(state.labelTimer);
    state.labelTimer = null;
    queueRouteAnimations(ctx);
    requestAnimationFrame(() => {
      if (ctx.layers.world) updateRouteLegend(ctx);
      declutterLabels(ctx);
    });
  });
}

/**
 * Registers the map and page listeners that follow the camera, the window
 * size, tab visibility and the URL hash.
 * @param {AtlasContext} ctx
 */
export function installViewEvents(ctx) {
  const { map, state, layers } = ctx;
  map.on('zoomend moveend', () => updateBadges(ctx));
  map.on('zoom', () => updateBasemap(ctx));
  installMoveEvents(ctx);
  // Hidden tabs stop every route animation.
  const teardown = new AbortController();
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) {
        queueRouteAnimations(ctx);
        return;
      }
      cancelRouteAnimations(ctx);
      updateRouteAnimations(ctx);
    },
    { signal: teardown.signal }
  );
  map.on('unload', () => {
    clearTimeout(state.labelTimer);
    cancelRouteAnimations(ctx);
    teardown.abort();
  });
  updateBasemap(ctx);
  map.on('resize', () => {
    // Fonts and sizes may change with the viewport; measure labels again.
    layers.cityMarkers.forEach(entry => {
      delete entry.labelSize;
    });
    if (layers.world) {
      updateBasemap(ctx);
      declutterLabels(ctx);
    }
  });
  window.addEventListener('hashchange', () => {
    if (layers.world) applyHash(ctx);
  });
}
