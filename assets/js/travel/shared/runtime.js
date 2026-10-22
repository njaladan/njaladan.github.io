import { stampedUrl } from '../../lib/assets.js';

/**
 * Resolves a path under the atlas's asset directory, independent of the URL
 * hosting the travel application.
 * @param {string} path
 * @returns {string}
 */
export const travelAsset = path =>
  stampedUrl(path, document.getElementById('map').dataset.assetBase);
