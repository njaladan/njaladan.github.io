// Asset location is independent of the URL hosting the travel application.
// Carries the build's cache-busting stamp (see _plugins/cache_bust.rb).
function travelAsset(path) {
  const url = new URL(path, new URL(document.getElementById('map').dataset.assetBase, location.href));
  const version = document.querySelector('meta[name="asset-version"]')?.content;
  if (version) url.searchParams.set('v', version);
  return url.href;
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
