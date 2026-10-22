// Pure geometry and timing helpers for the globe adapter. Nothing here touches
// the DOM, Leaflet or MapLibre, so unit tests can import it directly.

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
// Days from the Unix epoch to the J2000.0 epoch the solar formulas count from.
const J2000_DAYS = 10957.5;
// MapLibre's light position: radial distance, then azimuthal and polar angles.
const LIGHT_DISTANCE = 1.15;

/**
 * @typedef {{ x: number, y: number }} XY
 * @typedef {{ left: number, right: number, top: number, bottom: number }} Box
 * @typedef {{ now: number, lng: number }} Sample
 */

/**
 * Clamps `value` to the range [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * MapLibre lights the atmosphere from a fixed screen direction unless the
 * light is anchored to the map. Point that light at the date's subsolar point
 * so the bright limb turns with the Earth and follows the real sun.
 * @param {Date} [date]
 * @returns {{ anchor: 'map', position: number[] }}
 */
export function sunLight(date = new Date()) {
  const days = Number(date) / DAY_MS - J2000_DAYS;
  const mean = 280.46 + 0.9856474 * days,
    anomaly = (357.528 + 0.9856003 * days) * RAD;
  const ecliptic = (mean + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD,
    tilt = (23.439 - 4e-7 * days) * RAD;
  const lat = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const lng =
    Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic)) -
    (280.46061837 + 360.98564736629 * days) * RAD;
  // Globe frame: x east at 90°, y north, z out of 0°, 0°. MapLibre's light
  // position is spherical and points away from the sun.
  const x = -Math.sin(lng) * Math.cos(lat),
    y = -Math.sin(lat),
    z = -Math.cos(lng) * Math.cos(lat);
  return {
    anchor: 'map',
    position: [LIGHT_DISTANCE, Math.atan2(y, x) / RAD - 90, Math.acos(z) / RAD]
  };
}

/**
 * How far `box` sticks out of `root` once padded, as the [x, y] pan that
 * brings it back inside. The far edges win when both overflow.
 * @param {Box} box
 * @param {Box} root
 * @param {number[]} topLeft padding
 * @param {number[]} bottomRight padding
 * @returns {number[]}
 */
export function panOverflow(box, root, topLeft, bottomRight) {
  const axis = (low, high, i) => {
    if (box[high] > root[high] - bottomRight[i]) return box[high] - root[high] + bottomRight[i];
    if (box[low] < root[low] + topLeft[i]) return box[low] - root[low] - topLeft[i];
    return 0;
  };
  return [axis('left', 'right', 0), axis('top', 'bottom', 1)];
}

/**
 * SVG path commands joining `points` with straight lines.
 * @param {XY[]} points
 * @returns {string}
 */
const pointList = points => points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L');

/**
 * Path data for open polylines, one subpath per part.
 * @param {XY[][]} parts
 * @returns {string}
 */
export const linePath = parts => parts.map(part => `M${pointList(part)}`).join('');

/**
 * Path data for one closed ring; rings with fewer than three points vanish.
 * @param {XY[]} points
 * @returns {string}
 */
export const ringPath = points => (points.length > 2 ? `M${pointList(points)}Z` : '');

/**
 * The signed difference `to - from` in degrees, wrapped into [-180, 180).
 * @param {number} to
 * @param {number} from
 * @returns {number}
 */
export const longitudeDelta = (to, from) => ((to - from + 540) % 360) - 180;

/**
 * Whether two longitudes name the same meridian, allowing for float error.
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export const sameLongitude = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180) < 1e-6;
