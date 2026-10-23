// A little cabin that rides a gondola line, back and forth, while it is hovered.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

// One way takes about this long per kilometre of cable, within these bounds (ms).
const MS_PER_KM = 1400;
const MIN_TRIP_MS = 2600;
const MAX_TRIP_MS = 9000;
// The cabin rests this long at each station before heading back (ms).
const STATION_PAUSE_MS = 700;
// The cabin rides above the route tooltips, which would otherwise hide it.
const PANE = 'gondola';
const PANE_Z = 660;

const CABIN_SVG = `<svg viewBox="0 0 24 34" aria-hidden="true">
  <circle cx="12" cy="3" r="2.4" class="gondola-wheel"/>
  <path d="M12 5v8" class="gondola-hanger"/>
  <rect x="3" y="13" width="18" height="17" rx="4" class="gondola-body"/>
  <rect x="5.5" y="16" width="5.5" height="6" rx="1.2" class="gondola-window"/>
  <rect x="13" y="16" width="5.5" height="6" rx="1.2" class="gondola-window"/>
</svg>`;

/** @param {number} t */
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Cumulative distances (m) along the line, so the cabin keeps a steady pace.
 * @param {any} L
 * @param {number[][]} coords
 */
function measure(L, coords) {
  const points = coords.map(([lat, lng]) => L.latLng(lat, lng));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + points[i - 1].distanceTo(points[i]));
  }
  return { points, lengths, total: lengths[lengths.length - 1] };
}

/**
 * The point a given distance along the line.
 * @param {{ points: any[], lengths: number[] }} line
 * @param {number} distance
 */
function pointAt({ points, lengths }, distance) {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < distance) i++;
  const span = lengths[i] - lengths[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (distance - lengths[i - 1]) / span));
  const [a, b] = [points[i - 1], points[i]];
  return [a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t];
}

/**
 * Builds the cabin for one gondola line; `start` and `stop` follow the hover.
 * @param {AtlasContext} ctx
 * @param {number[][]} coords
 * @param {string} color
 */
export function gondolaRide(ctx, coords, color) {
  const { L, map } = ctx;
  const line = measure(L, coords);
  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.style.zIndex = String(PANE_Z);
    pane.style.pointerEvents = 'none';
  }
  const tripMs = Math.min(MAX_TRIP_MS, Math.max(MIN_TRIP_MS, (line.total / 1000) * MS_PER_KM));
  const icon = L.divIcon({
    className: 'gondola-cabin',
    html: `<span style="--mode:${color}">${CABIN_SVG}</span>`,
    iconSize: [24, 34],
    // The wheel sits on the cable.
    iconAnchor: [12, 3]
  });
  const marker = L.marker(line.points[0], {
    icon,
    pane: PANE,
    interactive: false,
    keyboard: false
  });
  /** @type {number | null} */
  let frame = null;
  let began = 0;

  /** @param {number} now */
  const step = now => {
    // A round trip: up, pause, down, pause.
    const leg = tripMs + STATION_PAUSE_MS;
    const phase = (now - began) % (2 * leg);
    const outbound = phase < leg;
    const t = Math.min(1, (outbound ? phase : phase - leg) / tripMs);
    const progress = outbound ? easeInOut(t) : 1 - easeInOut(t);
    marker.setLatLng(pointAt(line, progress * line.total));
    // The cabin swings as it pulls away from and into each station.
    const swing = Math.sin(t * Math.PI * 2) * (t < 1 ? 7 : 0) * (outbound ? -1 : 1);
    marker.getElement()?.style.setProperty('--swing', `${swing.toFixed(2)}deg`);
    frame = requestAnimationFrame(step);
  };

  return {
    start() {
      if (frame !== null || line.total === 0) return;
      marker.setLatLng(line.points[0]).addTo(map);
      if (ctx.reduceMotion) {
        marker.setLatLng(pointAt(line, line.total / 2));
        return;
      }
      began = performance.now();
      frame = requestAnimationFrame(step);
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      marker.remove();
    }
  };
}
