import { createDecodedCache } from './decoded-photos.js';
import { VIEWER_VARIANTS, photoLabel, viewerVariant } from './photo-records.js';

// The viewer's photo: shows the best pixels at hand at once (a decoded copy
// or the pin's thumbnail), then decodes a sharper variant offscreen and swaps
// it in when the frame is not moving.

const LOADING_MESSAGE = 'Loading photo…';
const FAILED_MESSAGE = 'Photo could not load. Close and reopen to retry.';

/**
 * @typedef {import('./photo-records.js').Photo} Photo
 * @typedef {{node: HTMLImageElement, photo: Photo, src: string, width: number, ready: boolean}} ImageRequest
 */

/**
 * @param {{image: HTMLImageElement, pixels: HTMLElement, status: HTMLElement, well: HTMLElement}} parts
 * @param {{asset: (src: string) => string, scale: () => number, canCommit: () => boolean}} options
 *   `scale` is the current zoom; `canCommit` is false while the frame moves or closes.
 */
export function createViewerImage({ image, pixels, status, well }, { asset, scale, canCommit }) {
  const decoded = createDecodedCache();
  /** @type {ImageRequest | null} */
  let request = null;

  function show(src, photo, width) {
    // Retain these decoded pixels as a paint fallback when changing the img src
    // or moving the dialog into/out of the browser's modal layer.
    pixels.style.backgroundImage = `url("${src}")`;
    image.src = src;
    image.dataset.photoId = photo.id;
    image.dataset.variantWidth = String(width);
  }
  function clear() {
    image.removeAttribute('src');
    delete image.dataset.photoId;
    delete image.dataset.variantWidth;
    pixels.style.removeProperty('background-image');
  }
  function cancel() {
    const pending = request;
    request = null;
    if (pending && !pending.ready) pending.node.removeAttribute('src');
  }
  function commit() {
    if (!request?.ready || !canCommit()) return;
    show(request.src, request.photo, request.width);
    status.textContent = '';
    request = null;
  }
  /** @param {ImageRequest} pending */
  function decode(pending) {
    // Decode offscreen, keeping the displayed image untouched during loading.
    pending.node.decode().then(
      () => {
        if (request !== pending) return;
        pending.ready = true;
        const { naturalWidth, naturalHeight } = pending.node;
        decoded.remember(pending.photo.id, {
          src: pending.src,
          width: pending.width,
          pixelCount: naturalWidth * naturalHeight
        });
        commit();
      },
      () => {
        if (request !== pending) return;
        request = null;
        status.textContent = FAILED_MESSAGE;
      }
    );
  }
  /**
   * Requests the variant that fills the frame at the current zoom.
   * @param {Photo} photo
   */
  function load(photo) {
    // Measure the final, inset image area once, before starting the animation.
    const rendered = Math.min(well.clientWidth, (well.clientHeight * photo.width) / photo.height);
    const variant = viewerVariant(photo, rendered * devicePixelRatio * scale());
    const shown = image.dataset.photoId === photo.id;
    if (shown && Number(image.dataset.variantWidth) >= variant.width) return;
    if (request?.photo.id === photo.id && request.width >= variant.width) return;
    cancel();
    const node = new Image();
    node.decoding = 'async';
    request = { node, photo, src: asset(variant.src), width: variant.width, ready: false };
    status.textContent = LOADING_MESSAGE;
    node.src = request.src;
    decode(request);
  }
  /**
   * Shows a new photo at once with the best pixels already available.
   * @param {Photo} photo
   * @param {HTMLImageElement | null | undefined} thumbnail the pin's thumbnail
   */
  function preview(photo, thumbnail) {
    cancel();
    image.alt = photo.caption || `Photo at ${photoLabel(photo)}`;
    image.width = photo.width;
    image.height = photo.height;
    image.decoding = 'async';
    const sources = VIEWER_VARIANTS.map(key => asset(photo.variants[key].src));
    const cached = decoded.take(photo.id, sources);
    if (cached) show(cached.src, photo, cached.width);
    else if (thumbnail?.complete && thumbnail.naturalWidth) {
      show(thumbnail.currentSrc, photo, photo.variants.thumbnail.width);
    } else clear();
    status.textContent = cached ? '' : LOADING_MESSAGE;
  }
  return { load, preview, commit, cancel, clear, forget: decoded.clear };
}
