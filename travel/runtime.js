// Asset location is independent of the URL hosting the travel application.
function travelAsset(path) {
  return new URL(path, new URL(document.getElementById('map').dataset.assetBase, location.href)).href;
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
