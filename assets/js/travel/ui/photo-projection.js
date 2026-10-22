// Leaflet rounds both projected points and its pixel origin. At fractional
// zoom those rounding boundaries move independently, making prints vibrate.
// Keep photo projection continuous, including during interrupted animations.

/**
 * Unrounded conversions between coordinates and container or layer points.
 * @param {any} map
 */
export function createProjection(map) {
  /** @param {any} coords */
  const containerPoint = coords =>
    map.project(coords).subtract(map.project(map.getCenter())).add(map.getSize().divideBy(2));
  return {
    containerPoint,
    /** @param {any} coords */
    layerPoint: coords => map.containerPointToLayerPoint(containerPoint(coords)),
    /** @param {any} point layer point */
    layerLatLng: point =>
      map.unproject(
        map
          .project(map.getCenter())
          .add(map.layerPointToContainerPoint(point))
          .subtract(map.getSize().divideBy(2))
      )
  };
}

/** @typedef {ReturnType<typeof createProjection>} Projection */
