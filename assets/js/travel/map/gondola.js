// A little cabin that rides a gondola line, back and forth, while it is hovered.

/** @typedef {import('./context.js').AtlasContext} AtlasContext */

// One way takes about this long per kilometre of cable, within these bounds (ms).
const MS_PER_KM = 1400;
const MIN_TRIP_MS = 2600;
const MAX_TRIP_MS = 9000;
// The cabin rests this long at each station before heading back (ms).
const STATION_PAUSE_MS = 700;
// The cabin hangs like a pendulum: changes in its sideways speed, turns at
// corners and the jolt of each arrival set it swinging, and then it settles.
const SWING_STIFFNESS = 30; // 1/s², about a 1.1 s swing
const SWING_DAMPING = 1.5; // 1/s
// Kicks to the swing's rate (deg/s) per change in velocity, measured against
// the cabin's average speed on screen so it swings alike at every zoom.
const SIDEWAYS_KICK = 60;
const TURN_KICK = 150;
const ARRIVAL_KICK = 160;
const MAX_SWING = 30; // degrees
// Steps longer than this (a background tab) restart the swing (s).
const MAX_STEP_S = 0.1;
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
 * A pendulum for the hanging cabin, driven by the cabin's screen position.
 * Its angle is in degrees, clockwise.
 */
function pendulum() {
  let angle = 0;
  let spin = 0;
  // The average screen speed (px/s) that changes in velocity are measured against.
  let averageSpeed = 1;
  /** @type {{ x: number, y: number, vx: number | null, vy: number, at: number } | null} */
  let last = null;
  return {
    get angle() {
      return angle;
    },
    /** @param {number} speed */
    reset(speed) {
      angle = 0;
      spin = 0;
      averageSpeed = Math.max(1, speed);
      last = null;
    },
    /** @param {number} amount Change in the swing's rate (deg/s). */
    kick(amount) {
      spin += amount;
    },
    /**
     * Advances the swing to the cabin's new screen position.
     * @param {{ x: number, y: number }} point
     * @param {number} now
     */
    update({ x, y }, now) {
      const dt = last ? (now - last.at) / 1000 : 0;
      if (last && dt <= 0) return;
      if (!last || dt > MAX_STEP_S) {
        // Start measuring afresh; the first speed has nothing to change from.
        last = { x, y, vx: null, vy: 0, at: now };
        return;
      }
      const vx = (x - last.x) / dt,
        vy = (y - last.y) / dt;
      if (last.vx !== null) {
        // A cabin pulled right lags behind, so its body swings left: clockwise.
        // Turning right does the same, as the cabin carries on straight.
        const speed = Math.hypot(last.vx, last.vy);
        const turn = speed > 1 ? (last.vx * vy - last.vy * vx) / speed : 0;
        spin += ((vx - last.vx) * SIDEWAYS_KICK + turn * TURN_KICK) / averageSpeed;
      }
      last = { x, y, vx, vy, at: now };
      spin += (-SWING_STIFFNESS * angle - SWING_DAMPING * spin) * dt;
      angle = Math.max(-MAX_SWING, Math.min(MAX_SWING, angle + spin * dt));
    }
  };
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
  let arrived = false;
  const cabin = pendulum();

  /**
   * How far right the cable runs into a station, from -1 to 1.
   * @param {any} station
   * @param {any} before
   */
  const approach = (station, before) => {
    const a = map.project(before),
      b = map.project(station);
    return (b.x - a.x) / (a.distanceTo(b) || 1);
  };

  /** @param {number} now */
  const step = now => {
    // A round trip: up, pause, down, pause.
    const leg = tripMs + STATION_PAUSE_MS;
    const phase = (now - began) % (2 * leg);
    const outbound = phase < leg;
    const t = Math.min(1, (outbound ? phase : phase - leg) / tripMs);
    const progress = outbound ? easeInOut(t) : 1 - easeInOut(t);
    const here = pointAt(line, progress * line.total);
    marker.setLatLng(here);
    // Unrounded, unlike latLngToLayerPoint, so the speed does not jitter.
    cabin.update(map.project(here), now);
    if (t === 1 && !arrived) {
      // Stopping at the station throws the cabin on the way it was going.
      const { points } = line,
        n = points.length;
      const heading = outbound
        ? approach(points[n - 1], points[n - 2])
        : approach(points[0], points[1]);
      cabin.kick(-heading * ARRIVAL_KICK);
    }
    arrived = t === 1;
    marker.getElement()?.style.setProperty('--swing', `${cabin.angle.toFixed(2)}deg`);
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
      let px = 0;
      for (let i = 1; i < line.points.length; i++) {
        px += map.project(line.points[i - 1]).distanceTo(map.project(line.points[i]));
      }
      cabin.reset(px / (tripMs / 1000));
      began = performance.now();
      arrived = false;
      frame = requestAnimationFrame(step);
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      marker.remove();
    }
  };
}
