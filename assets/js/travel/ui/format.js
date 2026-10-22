// Display formatting for route cards and itineraries. Side-effect free.

const KM_PER_MILE = 1.609344;

/**
 * Localized distance value and its unit label, e.g. ['12.5', 'Km'].
 * @param {number} distanceKm
 * @param {number | undefined} precision fraction digits
 * @param {'km' | 'mi'} unit
 * @returns {[string, string]}
 */
export function formatDistance(distanceKm, precision, unit) {
  const value = unit === 'mi' ? distanceKm / KM_PER_MILE : distanceKm;
  return [
    value.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    }),
    unit === 'mi' ? 'Miles' : 'Km'
  ];
}

/**
 * Elapsed time as hours and minutes, e.g. 5400 → '1:30'.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Short weekday date for an ISO day, read at local noon so it never shifts a day.
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export const formatDay = date =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

/**
 * `count noun`, adding an "s" unless the count is one.
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
export const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
