// Validation, ordering and labels for atlas photo records. Side-effect free.

// Photo files must come from the atlas, never arbitrary URLs from data.
const ATLAS_PHOTO_PATH = /^images\/travel\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|jpg|png)$/;
export const PHOTO_VARIANTS = ['thumbnail', 'small', 'medium', 'large'];
// Variants the viewer may display, smallest first by convention.
export const VIEWER_VARIANTS = ['small', 'medium', 'large'];
// Stacking depth of the newest photo's print is DEPTH_BASE + photo count.
const DEPTH_BASE = 1000;

/**
 * @typedef {{src: string, width: number}} PhotoVariant
 * @typedef {{id: string, place: string, coords: number[], width: number, height: number,
 *   date?: string, country?: string, caption?: string,
 *   gallery?: {subject?: string, location?: string},
 *   variants: Record<string, PhotoVariant>}} Photo
 */

/**
 * @param {unknown} src
 * @returns {src is string}
 */
export const isAtlasPhotoPath = src => typeof src === 'string' && ATLAS_PHOTO_PATH.test(src);

const isPositive = value => Number.isFinite(value) && value > 0;

/**
 * @param {any} coords
 * @returns {boolean} whether coords is a valid [lat, lng]
 */
const isLatLng = coords =>
  Array.isArray(coords) &&
  coords.length === 2 &&
  coords.every(Number.isFinite) &&
  Math.abs(coords[0]) <= 90 &&
  Math.abs(coords[1]) <= 180;

/**
 * @param {any} photo
 * @returns {photo is Photo}
 */
export function isValidPhoto(photo) {
  return Boolean(
    photo &&
    typeof photo.id === 'string' &&
    typeof photo.place === 'string' &&
    isLatLng(photo.coords) &&
    isPositive(photo.width) &&
    isPositive(photo.height) &&
    PHOTO_VARIANTS.every(
      key =>
        isAtlasPhotoPath(photo.variants?.[key]?.src) && Number.isFinite(photo.variants[key].width)
    )
  );
}

/**
 * Valid photos with unique ids, newest first, then by id.
 * @param {unknown} records
 * @returns {Photo[]}
 */
export function normalizePhotos(records) {
  const ids = new Set();
  const photos = (Array.isArray(records) ? records : []).filter(photo => {
    if (!isValidPhoto(photo) || ids.has(photo.id)) return false;
    ids.add(photo.id);
    return true;
  });
  return photos.sort(
    (a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id)
  );
}

/**
 * Stacking depth per photo id: newer photos sit above older ones.
 * @param {Photo[]} photos in display order
 * @returns {Map<string, number>}
 */
export const photoDepths = photos =>
  new Map(photos.map((photo, index) => [photo.id, DEPTH_BASE + photos.length - index]));

/**
 * Subject and location, e.g. 'Glymur — Iceland'.
 * @param {Photo} photo
 */
export function photoLabel(photo) {
  const subject = photo.gallery?.subject || photo.place;
  const location = photo.gallery?.location || '';
  return location ? `${subject} — ${location}` : subject;
}

/**
 * Identity of a pin: its photos in order.
 * @param {Photo[]} items
 */
export const groupKey = items => items.map(photo => photo.id).join('|');

/**
 * The smallest viewer variant covering `needed` device pixels, else the largest.
 * @param {Photo} photo
 * @param {number} needed
 * @returns {PhotoVariant}
 */
export function viewerVariant(photo, needed) {
  const variants = VIEWER_VARIANTS.map(key => photo.variants[key]).sort(
    (a, b) => a.width - b.width
  );
  return variants.find(item => item.width >= needed) || variants[variants.length - 1];
}
