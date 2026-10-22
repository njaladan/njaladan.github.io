// Recently decoded viewer images, kept so reopening a photo paints at once
// without retaining the whole album. Side-effect free.

const MAX_ENTRIES = 8;
const MAX_PIXELS = 12_000_000;

/**
 * @typedef {{src: string, width: number, pixelCount: number}} DecodedEntry
 */

/**
 * A least-recently-used cache of decoded images by photo id, bounded by
 * count and total pixels (always keeping the newest entry).
 * @param {{maxEntries?: number, maxPixels?: number}} [limits]
 */
export function createDecodedCache({ maxEntries = MAX_ENTRIES, maxPixels = MAX_PIXELS } = {}) {
  /** @type {Map<string, DecodedEntry>} */
  const entries = new Map();
  let pixels = 0;
  function remove(id) {
    pixels -= entries.get(id).pixelCount;
    entries.delete(id);
  }
  return {
    get pixels() {
      return pixels;
    },
    get size() {
      return entries.size;
    },
    /**
     * Keeps a decoded image unless a wider one is already cached.
     * @param {string} id
     * @param {DecodedEntry} entry
     */
    remember(id, entry) {
      const old = entries.get(id);
      if (old && old.width >= entry.width) return;
      if (old) remove(id);
      entries.set(id, entry);
      pixels += entry.pixelCount;
      while (entries.size > maxEntries || (pixels > maxPixels && entries.size > 1)) {
        remove(entries.keys().next().value);
      }
    },
    /**
     * The cached image for a photo, if its source is still one of `sources`;
     * marks it most recently used.
     * @param {string} id
     * @param {string[]} sources
     * @returns {DecodedEntry | null}
     */
    take(id, sources) {
      const entry = entries.get(id);
      if (!entry) return null;
      remove(id);
      if (!sources.includes(entry.src)) return null;
      entries.set(id, entry);
      pixels += entry.pixelCount;
      return entry;
    },
    clear() {
      entries.clear();
      pixels = 0;
    }
  };
}
