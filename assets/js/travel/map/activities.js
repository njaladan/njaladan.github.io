import { splitAtGaps } from './geometry.js';

// Display geometry for recorded activities, computed once per day and cached.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

// GPS pauses on walks leave straight jumps longer than this (km); break the line there.
const WALK_GAP_KM = 0.5;

/**
 * @param {AtlasContext} ctx
 * @param {any} day An activity record.
 */
function trackGeometry(ctx, day) {
  const cache = ctx.layers.activityGeometry;
  if (cache.has(day)) return cache.get(day);
  const segments = day.segments || (day.coords ? [day.coords] : []);
  const display =
    day.sport === 'Walk'
      ? segments.flatMap(segment => splitAtGaps(segment, ctx.cards.haversine, WALK_GAP_KM))
      : segments;
  const points = display.flat();
  const geometry = { segments: display, points, bounds: ctx.L.latLngBounds(points) };
  cache.set(day, geometry);
  return geometry;
}

/**
 * @param {AtlasContext} ctx
 * @param {any} day
 * @returns {number[][][]}
 */
export const daySegments = (ctx, day) => trackGeometry(ctx, day).segments;

/**
 * @param {AtlasContext} ctx
 * @param {any} day
 * @returns {number[][]}
 */
export const dayPoints = (ctx, day) => trackGeometry(ctx, day).points;

/**
 * @param {AtlasContext} ctx
 * @param {any} day
 */
export const dayBounds = (ctx, day) => trackGeometry(ctx, day).bounds;

/**
 * The day's longest drawn segment, where its badge and card sit.
 * @param {AtlasContext} ctx
 * @param {any} day
 */
export const longestSegment = (ctx, day) =>
  daySegments(ctx, day).reduce((a, b) => (b.length > a.length ? b : a), []);
