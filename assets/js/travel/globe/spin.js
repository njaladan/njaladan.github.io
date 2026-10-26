// Earth turns east, so the camera drifts west: a quick turn as the page
// loads settles into a slow idle spin. Touching the globe holds it; once
// the visitor lets go and the camera rests, it eases back into the drift.
//
// Spin state lives on the GlobeMap (`_spinTarget`, `_spinTimer`, `_spinning`)
// so the smooth-zoom hook and stopSpin can see a turn in progress.
import {
  FLING_SECONDS,
  IDLE_SPEED,
  addSample,
  flingTravel,
  idleRise,
  introTravel,
  releaseSpeed,
  splitEase
} from './spin-curves.js';
import { sameLongitude } from './math.js';

// The camera holds still at or above this MapLibre zoom.
const SPIN_MAX_ZOOM = 3;
const INTRO_SECONDS = 4;
const RISE_SECONDS = 4;
// The drift continues in steps of this many degrees.
const DRIFT_STEP = 30;
// Quiet time before the camera counts as resting.
const REST_MS = 1500;
// MapLibre eases the globe the short way round, so a turn past 180° would
// run backwards. Longer turns go in legs no wider than this.
const MAX_LEG_DEGREES = 90;

/**
 * A linear-in-time ease covering `curve` from 0 to `seconds`.
 * @param {(t: number) => number} curve
 * @param {number} seconds
 * @returns {(t: number) => number}
 */
const easeAlong = (curve, seconds) => t => curve(t * seconds) / curve(seconds);

class IdleSpin {
  /** @param {any} globe the GlobeMap */
  constructor(globe) {
    this.globe = globe;
    this.map = globe.nativeMap;
    this.held = false;
    this.dir = 1;
    /** @type {import('./math.js').Sample[]} */
    this.samples = [];
  }

  /**
   * Eases the camera `degrees` west, then keeps drifting if it lands.
   * @param {number} degrees
   * @param {number} seconds
   * @param {(t: number) => number} easing
   */
  turn(degrees, seconds, easing) {
    const pieces = Math.max(1, Math.ceil(Math.abs(degrees) / MAX_LEG_DEGREES));
    this.ease(
      splitEase(easing, pieces).map(piece => ({
        degrees: degrees / pieces,
        seconds: (piece.end - piece.start) * seconds,
        easing: piece.easing
      }))
    );
  }

  /**
   * Runs the legs of a turn in order, then drifts on.
   * @param {{ degrees: number, seconds: number, easing: (t: number) => number }[]} legs
   */
  ease([leg, ...rest]) {
    const { globe, map } = this;
    const { lng, lat } = map.getCenter();
    globe._spinTarget = lng - leg.degrees;
    map.easeTo({
      center: [globe._spinTarget, lat],
      duration: leg.seconds * 1000,
      easing: leg.easing,
      essential: true
    });
    // Any other camera change interrupts the ease before it lands.
    map.once('moveend', () => {
      const landed =
        globe._spinTarget !== null && sameLongitude(map.getCenter().lng, globe._spinTarget);
      if (landed && !globe._removed) {
        if (rest.length) this.ease(rest);
        else this.turn(DRIFT_STEP * this.dir, DRIFT_STEP / IDLE_SPEED, t => t);
      } else {
        globe._spinTarget = null;
        this.resume();
      }
    });
  }

  // Wait for the camera to rest. Zoomed in, open cards and the photo
  // viewer keep it still; the next camera move or closed card checks again.
  resume() {
    const { globe, map } = this;
    clearTimeout(globe._spinTimer);
    if (!globe._spinning) return;
    globe._spinTimer = setTimeout(() => {
      if (this.held || globe._spinTarget !== null || map.isMoving()) return;
      if (map.getZoom() >= SPIN_MAX_ZOOM) return;
      if (globe._popup || document.querySelector('dialog[open]')) {
        this.resume();
        return;
      }
      this.turn(this.dir * idleRise(RISE_SECONDS), RISE_SECONDS, easeAlong(idleRise, RISE_SECONDS));
    }, REST_MS);
  }

  // Even a click without a drag takes the camera, so halt the turn in progress.
  halt() {
    this.dir = 1;
    clearTimeout(this.globe._spinTimer);
    if (this.globe._spinTarget !== null) {
      this.globe._spinTarget = null;
      this.map.stop();
    }
  }

  /**
   * Holds the spin while pressed, and nudges it on wheel and keyboard input.
   * @param {AbortSignal} signal
   */
  listen(signal) {
    const container = this.globe._container,
      options = { capture: true, passive: true, signal };
    const nudge = () => {
      this.halt();
      this.resume();
    };
    const letGo = () => {
      if (this.held) {
        this.held = false;
        this.resume();
      }
    };
    container.addEventListener(
      'pointerdown',
      () => {
        this.held = true;
        this.halt();
      },
      options
    );
    window.addEventListener('pointerup', letGo, options);
    window.addEventListener('pointercancel', letGo, options);
    container.addEventListener('wheel', nudge, options);
    container.addEventListener('keydown', nudge, options);
  }

  // A throw keeps going: the release speed (westward degrees per second)
  // eases down to the idle drift in the direction it was thrown. Slower
  // flicks coast to a stop and wait like any other touch.
  trackThrows() {
    const map = this.map;
    map.on('dragstart', () => {
      this.samples = [];
    });
    map.on('move', event => {
      if (!event.originalEvent || !map.dragPan.isActive()) return;
      this.samples = addSample(this.samples, performance.now(), map.getCenter().lng);
    });
    map.on('dragend', () => {
      const speed = releaseSpeed(this.samples, performance.now());
      this.samples = [];
      if (speed === null || map.getZoom() >= SPIN_MAX_ZOOM || Math.abs(speed) <= IDLE_SPEED) {
        return;
      }
      setTimeout(() => this.fling(speed));
    });
  }

  /** @param {number} speed westward degrees per second at release */
  fling(speed) {
    const globe = this.globe;
    if (this.held || globe._removed || !globe._spinning) return;
    this.dir = Math.sign(speed);
    const curve = t => flingTravel(speed, t);
    this.map.stop();
    this.turn(curve(FLING_SECONDS), FLING_SECONDS, easeAlong(curve, FLING_SECONDS));
  }

  // The page-load turn starts ahead of home and sweeps back past it.
  intro() {
    const map = this.map;
    const { lng, lat } = (this.globe._homeCenter = map.getCenter());
    map.jumpTo({ center: [lng + introTravel(INTRO_SECONDS), lat] });
    this.turn(introTravel(INTRO_SECONDS), INTRO_SECONDS, easeAlong(introTravel, INTRO_SECONDS));
  }
}

/**
 * Starts the idle spin on a loaded GlobeMap.
 * @param {any} globe
 */
export function startSpin(globe) {
  const spin = new IdleSpin(globe);
  globe._spinAbort = new AbortController();
  spin.listen(globe._spinAbort.signal);
  spin.trackThrows();
  globe._spinning = true;
  globe.nativeMap.on('moveend', () => {
    if (globe._spinTarget === null) spin.resume();
  });
  globe.on('popupclose', () => spin.resume());
  if (globe.nativeMap.getZoom() >= SPIN_MAX_ZOOM) return;
  spin.intro();
}

/**
 * Stops the idle spin for good and releases its DOM listeners.
 * @param {any} globe
 */
export function stopSpin(globe) {
  globe._spinning = false;
  clearTimeout(globe._spinTimer);
  // Undefined until a spin has ever started.
  if (globe._spinTarget != null) {
    globe._spinTarget = null;
    globe.nativeMap.stop();
  }
  globe._spinAbort?.abort();
}
