// Smoothness analysis. One streaming analyzer: live GPS fixes and GPX track points are fed
// through the same push(), one fix at a time, so a drive scores the same however it was
// recorded. All kinematics come from GPS (speed and heading), not from phone sensors, so
// results don't depend on how the phone is mounted.
import { distance, bearing, wrapAngle } from "./geo.js";

// Bump when the scoring changes; stored drives are re-scored automatically.
export const ANALYSIS_VERSION = 2; // 2: summaries gained car (OBD) data

export const DEFAULTS = {
  maxAccuracy: 30, // m; worse fixes are ignored
  minInterval: 0.2, // s; fixes closer together than this are skipped
  maxGap: 10, // s; longer gaps reset the kinematics (tunnel, signal loss)
  speedSmoothing: 1.5, // s; time constant for smoothing speed
  accelSmoothing: 1.5, // s; time constant for smoothing acceleration
  movingSpeed: 1, // m/s; below this the car counts as stopped
  harshBrake: -2.5, // m/s²
  harshAccel: 2.0, // m/s²
  harshLateral: 3.0, // m/s²
  eventCooldown: 3, // s; one event per manoeuvre
  liveWindow: 10, // s; rolling window for the live score
};

/**
 * Score 0..100 from RMS jerk (m/s³), RMS longitudinal acceleration (m/s²) and harsh events
 * per 10 km. Calm driving lands around 80+, aggressive driving around 30.
 */
export function scoreFrom({ rmsJerk, rmsAccel, harshPer10km = 0 }) {
  const penalty = 0.4 * rmsJerk + 0.2 * rmsAccel + 0.05 * harshPer10km;
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-penalty))));
}

/** Exponential smoothing: move `previous` toward `next` over time constant `timeConstant`. */
const smooth = (previous, next, interval, timeConstant) =>
  previous + (1 - Math.exp(-interval / timeConstant)) * (next - previous);

/** The sample returned for a fix that only (re)starts the kinematics. */
const restartSample = (time, speed) => ({
  time,
  speed,
  accel: 0,
  jerk: 0,
  lateral: 0,
  event: null,
});

export function createAnalyzer(overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  const state = {
    firstFix: null,
    lastFix: null, // last accepted fix
    speed: 0, // m/s, smoothed
    accel: 0, // m/s², smoothed, along the direction of travel
    lateral: 0, // m/s², smoothed, sideways
    heading: null, // radians
    speedKnown: false, // false until the first fix with a speed (or the first segment)
    kinematic: false, // false right after start or a gap
    distance: 0, // m
    movingTime: 0, // s
    maxSpeed: 0,
    sumJerkSquared: 0, // ∫ jerk² dt while moving
    sumAccelSquared: 0, // ∫ accel² dt while moving
    sumLateralSquared: 0, // ∫ lateral² dt while moving
    brakeLoss: 0, // J/kg (= kJ per tonne) of kinetic energy lost while braking
    stops: 0,
    wasMoving: false,
    events: { brake: 0, accel: 0, lateral: 0 },
    eventLog: [],
    inEvent: { brake: false, accel: false, lateral: false },
    lastEventAt: { brake: -Infinity, accel: -Infinity, lateral: -Infinity },
    window: [], // recent samples for the live score
  };

  /** Count a harsh event once per manoeuvre: on entering it, with a cooldown. */
  function detectEvent(kind, active, released, fix) {
    const cooledDown = fix.t - state.lastEventAt[kind] >= options.eventCooldown * 1000;
    if (active && !state.inEvent[kind] && cooledDown) {
      state.events[kind]++;
      state.lastEventAt[kind] = fix.t;
      state.eventLog.push({ kind, t: fix.t, lat: fix.lat, lon: fix.lon });
      state.inEvent[kind] = true;
      return kind;
    }
    if (released) state.inEvent[kind] = false;
    return null;
  }

  /** Feed one fix. Returns the derived sample, or null if the fix was skipped. */
  function push(fix) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t))
      return null;
    if (fix.accuracy != null && fix.accuracy > options.maxAccuracy) return null;
    const hasSpeed = fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0;

    if (!state.lastFix) {
      state.firstFix = state.lastFix = fix;
      state.speed = hasSpeed ? fix.speed : 0;
      state.speedKnown = hasSpeed;
      return restartSample(fix.t, state.speed);
    }

    const interval = (fix.t - state.lastFix.t) / 1000; // s
    if (interval < options.minInterval) return null;
    const segment = distance(state.lastFix.lat, state.lastFix.lon, fix.lat, fix.lon); // m
    state.distance += segment;
    const rawSpeed = hasSpeed ? fix.speed : segment / interval;

    if (interval > options.maxGap || !state.speedKnown) {
      // Signal gap, or no speed known yet (first segment of a track without speeds):
      // keep the distance, (re)start the kinematics from this segment's speed.
      state.speedKnown = true;
      state.speed = rawSpeed;
      state.accel = 0;
      state.lateral = 0;
      state.heading = null;
      state.kinematic = false;
      state.lastFix = fix;
      return restartSample(fix.t, state.speed);
    }

    const speed = smooth(state.speed, rawSpeed, interval, options.speedSmoothing);
    const rawAccel = (speed - state.speed) / interval;
    const accel = state.kinematic
      ? smooth(state.accel, rawAccel, interval, options.accelSmoothing)
      : 0;
    const jerk = state.kinematic ? (accel - state.accel) / interval : 0;

    // Lateral acceleration = speed × yaw rate, from GPS heading changes.
    let lateral = 0;
    if (segment > 2 && speed > 3) {
      const heading = bearing(state.lastFix.lat, state.lastFix.lon, fix.lat, fix.lon);
      if (state.heading !== null) {
        const yawRate = wrapAngle(heading - state.heading) / interval;
        lateral = smooth(state.lateral, speed * yawRate, interval, options.accelSmoothing);
      }
      state.heading = heading;
    }

    const moving = speed > options.movingSpeed;
    if (moving && state.kinematic) {
      state.movingTime += interval;
      state.sumJerkSquared += jerk * jerk * interval;
      state.sumAccelSquared += accel * accel * interval;
      state.sumLateralSquared += lateral * lateral * interval;
    }
    if (accel < -0.5 && speed < state.speed) {
      state.brakeLoss += 0.5 * (state.speed * state.speed - speed * speed);
    }
    if (speed > 3) state.wasMoving = true;
    if (speed < 0.8 && state.wasMoving) {
      state.stops++;
      state.wasMoving = false;
    }
    state.maxSpeed = Math.max(state.maxSpeed, speed);

    let event = null;
    if (state.kinematic) {
      const { harshBrake, harshAccel, harshLateral } = options;
      event = detectEvent("brake", accel < harshBrake, accel > harshBrake * 0.6, fix) || event;
      event = detectEvent("accel", accel > harshAccel, accel < harshAccel * 0.6, fix) || event;
      event =
        detectEvent(
          "lateral",
          Math.abs(lateral) > harshLateral,
          Math.abs(lateral) < harshLateral * 0.6,
          fix,
        ) || event;
    }

    state.window.push({ time: fix.t, interval, jerk, accel, moving: moving && state.kinematic });
    while (state.window.length && fix.t - state.window[0].time > options.liveWindow * 1000) {
      state.window.shift();
    }

    state.speed = speed;
    state.accel = accel;
    state.lateral = lateral;
    state.lastFix = fix;
    state.kinematic = true;
    return { time: fix.t, speed, accel, jerk, lateral, event };
  }

  /** Rolling numbers for the live view (last `liveWindow` seconds). */
  function live() {
    let movingTime = 0;
    let sumJerkSquared = 0;
    let sumAccelSquared = 0;
    for (const sample of state.window) {
      if (!sample.moving) continue;
      movingTime += sample.interval;
      sumJerkSquared += sample.jerk * sample.jerk * sample.interval;
      sumAccelSquared += sample.accel * sample.accel * sample.interval;
    }
    const rmsJerk = movingTime > 0 ? Math.sqrt(sumJerkSquared / movingTime) : null;
    const rmsAccel = movingTime > 0 ? Math.sqrt(sumAccelSquared / movingTime) : null;
    return {
      speed: state.speed,
      accel: state.accel,
      rmsJerk,
      score: movingTime >= 3 ? scoreFrom({ rmsJerk, rmsAccel }) : null,
      harsh: state.events.brake + state.events.accel + state.events.lateral,
      distance: state.distance,
    };
  }

  /** The whole drive so far. These field names are stored with each drive: keep them. */
  function summary() {
    const movingTime = state.movingTime;
    const rms = (sumSquared) => (movingTime > 0 ? Math.sqrt(sumSquared / movingTime) : null);
    const rmsJerk = rms(state.sumJerkSquared);
    const rmsAccel = rms(state.sumAccelSquared);
    const rmsLateral = rms(state.sumLateralSquared);
    const harsh = state.events.brake + state.events.accel + state.events.lateral;
    const km = state.distance / 1000;
    const harshPer10km = km > 0 ? (harsh / km) * 10 : 0;
    const { firstFix, lastFix } = state;
    return {
      analysisVersion: ANALYSIS_VERSION,
      startedAt: firstFix ? firstFix.t : null,
      endedAt: lastFix ? lastFix.t : null,
      duration: firstFix ? (lastFix.t - firstFix.t) / 1000 : 0,
      distance: state.distance,
      movingTime,
      avgSpeed: movingTime > 0 ? state.distance / movingTime : 0,
      maxSpeed: state.maxSpeed,
      rmsJerk,
      rmsAccel,
      rmsLateral,
      events: { ...state.events },
      eventLog: state.eventLog.slice(),
      harsh,
      harshPer10km,
      brakeLossPerKm: km > 0 ? state.brakeLoss / km : 0,
      stops: state.stops,
      stopsPerKm: km > 0 ? state.stops / km : 0,
      // Too short to judge: no score rather than a misleading one.
      score: movingTime >= 30 && km >= 0.2 ? scoreFrom({ rmsJerk, rmsAccel, harshPer10km }) : null,
    };
  }

  return { push, live, summary };
}

/** Analyse a whole list of fixes (GPX import, re-scoring). Same code path as live. */
export function analyzeFixes(fixes, overrides) {
  const analyzer = createAnalyzer(overrides);
  for (const fix of fixes) analyzer.push(fix);
  return analyzer.summary();
}
