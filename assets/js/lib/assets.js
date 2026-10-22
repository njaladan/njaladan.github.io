// The build's cache-busting stamp (see _plugins/cache_bust.rb). URLs built at
// runtime carry it so each deploy fetches fresh data.

/** @returns {string | undefined} */
export const assetVersion = () =>
  document.querySelector('meta[name="asset-version"]')?.getAttribute('content') || undefined;

/**
 * Resolves `path` against `base` and adds the build's version stamp.
 * @param {string} path
 * @param {string} base
 * @returns {string}
 */
export function stampedUrl(path, base) {
  const url = new URL(path, new URL(base, location.href));
  const version = assetVersion();
  if (version) url.searchParams.set('v', version);
  return url.href;
}
