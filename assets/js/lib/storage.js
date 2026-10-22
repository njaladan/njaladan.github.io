// Web Storage throws in some private windows and when site data is blocked.
// Preferences are conveniences, so failures fall back to defaults silently.

/**
 * @param {string} key
 * @param {Storage} [storage]
 * @returns {string | null}
 */
export function readSetting(key, storage = localStorage) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @param {Storage} [storage]
 */
export function writeSetting(key, value, storage = localStorage) {
  try {
    storage.setItem(key, value);
  } catch {}
}
