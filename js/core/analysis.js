// Smoothness analysis. One streaming analyzer: live GPS fixes and GPX track points are fed
// through the same push(), one fix at a time, so a drive scores the same however it was
// recorded. All kinematics come from GPS (speed and heading), not from phone sensors, so
// results don't depend on how the phone is mounted.
import { distance, bearing, wrapAngle } from "./geo.js";

// Bump when the scoring changes; stored drives are re-scored automatically.
export const ANALYSIS_VERSION = 2; // 2: summaries gained car (OBD) data

export const DEFAULTS = {
  maxAccuracy: 30, // m; worse fixes are ignored
  minDt: 0.2, // s; closer fixes are skipped
  maxGap: 10, // s; longer gaps reset the kinematics (tunnel, signal loss)
  tauSpeed: 1.5, // s; speed smoothing
  tauAccel: 1.5, // s; acceleration smoothing
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
  const x = 0.4 * rmsJerk + 0.2 * rmsAccel + 0.05 * harshPer10km;
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-x))));
}

const ema = (prev, next, dt, tau) => prev + (1 - Math.exp(-dt / tau)) * (next - prev);

export function createAnalyzer(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const s = {
    first: null,
    last: null, // last accepted fix
    v: 0,
    a: 0,
    lat: 0,
    heading: null,
    kinematic: false, // false right after start or a gap
    distance: 0,
    movingTime: 0,
    maxSpeed: 0,
    sumJ2: 0,
    sumA2: 0,
    sumL2: 0,
    brakeLoss: 0, // J/kg (= kJ per tonne) of kinetic energy lost while braking
    stops: 0,
    wasMoving: false,
    events: { brake: 0, accel: 0, lateral: 0 },
    eventLog: [],
    inEvent: { brake: false, accel: false, lateral: false },
    lastEventAt: { brake: -Infinity, accel: -Infinity, lateral: -Infinity },
    window: [],
  };

  function event(kind, active, release, t, lat, lon) {
    if (active && !s.inEvent[kind] && t - s.lastEventAt[kind] >= o.eventCooldown * 1000) {
      s.events[kind]++;
      s.lastEventAt[kind] = t;
      s.eventLog.push({ kind, t, lat, lon });
      s.inEvent[kind] = true;
      return kind;
    }
    if (release) s.inEvent[kind] = false;
    return null;
  }

  /** Feed one fix. Returns the derived sample, or null if the fix was skipped. */
  function push(fix) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t))
      return null;
    if (fix.accuracy != null && fix.accuracy > o.maxAccuracy) return null;
    const hasSpeed = fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0;

    if (!s.last) {
      s.first = s.last = fix;
      s.v = hasSpeed ? fix.speed : 0;
      s.speedKnown = hasSpeed;
      return { t: fix.t, v: s.v, a: 0, j: 0, lat: 0, event: null };
    }

    const dt = (fix.t - s.last.t) / 1000;
    if (dt < o.minDt) return null;
    const d = distance(s.last.lat, s.last.lon, fix.lat, fix.lon);
    s.distance += d;
    const rawV = hasSpeed ? fix.speed : d / dt;

    if (dt > o.maxGap || !s.speedKnown) {
      // Signal gap, or no speed known yet (first segment of a track without speeds):
      // keep the distance, (re)start the kinematics from this segment's speed.
      s.speedKnown = true;
      s.v = rawV;
      s.a = 0;
      s.lat = 0;
      s.heading = null;
      s.kinematic = false;
      s.last = fix;
      return { t: fix.t, v: s.v, a: 0, j: 0, lat: 0, event: null };
    }

    const v = ema(s.v, rawV, dt, o.tauSpeed);
    const aRaw = (v - s.v) / dt;
    const a = s.kinematic ? ema(s.a, aRaw, dt, o.tauAccel) : 0;
    const j = s.kinematic ? (a - s.a) / dt : 0;

    // Lateral acceleration = speed × yaw rate, from GPS heading changes.
    let latAcc = 0;
    if (d > 2 && v > 3) {
      const h = bearing(s.last.lat, s.last.lon, fix.lat, fix.lon);
      if (s.heading !== null)
        latAcc = ema(s.lat, (v * wrapAngle(h - s.heading)) / dt, dt, o.tauAccel);
      s.heading = h;
    }

    const moving = v > o.movingSpeed;
    if (moving && s.kinematic) {
      s.movingTime += dt;
      s.sumJ2 += j * j * dt;
      s.sumA2 += a * a * dt;
      s.sumL2 += latAcc * latAcc * dt;
    }
    if (a < -0.5 && v < s.v) s.brakeLoss += 0.5 * (s.v * s.v - v * v);
    if (v > 3) s.wasMoving = true;
    if (v < 0.8 && s.wasMoving) {
      s.stops++;
      s.wasMoving = false;
    }
    s.maxSpeed = Math.max(s.maxSpeed, v);

    let ev = null;
    if (s.kinematic) {
      ev = event("brake", a < o.harshBrake, a > o.harshBrake * 0.6, fix.t, fix.lat, fix.lon) || ev;
      ev = event("accel", a > o.harshAccel, a < o.harshAccel * 0.6, fix.t, fix.lat, fix.lon) || ev;
      ev =
        event(
          "lateral",
          Math.abs(latAcc) > o.harshLateral,
          Math.abs(latAcc) < o.harshLateral * 0.6,
          fix.t,
          fix.lat,
          fix.lon,
        ) || ev;
    }

    s.window.push({ t: fix.t, dt, j, a, moving: moving && s.kinematic });
    while (s.window.length && fix.t - s.window[0].t > o.liveWindow * 1000) s.window.shift();

    s.v = v;
    s.a = a;
    s.lat = latAcc;
    s.last = fix;
    s.kinematic = true;
    return { t: fix.t, v, a, j, lat: latAcc, event: ev };
  }

  /** Rolling numbers for the live view (last `liveWindow` seconds). */
  function live() {
    let time = 0;
    let j2 = 0;
    let a2 = 0;
    for (const w of s.window) {
      if (!w.moving) continue;
      time += w.dt;
      j2 += w.j * w.j * w.dt;
      a2 += w.a * w.a * w.dt;
    }
    const rmsJerk = time > 0 ? Math.sqrt(j2 / time) : null;
    const rmsAccel = time > 0 ? Math.sqrt(a2 / time) : null;
    return {
      speed: s.v,
      accel: s.a,
      rmsJerk,
      score: time >= 3 ? scoreFrom({ rmsJerk, rmsAccel }) : null,
      harsh: s.events.brake + s.events.accel + s.events.lateral,
      distance: s.distance,
    };
  }

  function summary() {
    const t = s.movingTime;
    const rmsJerk = t > 0 ? Math.sqrt(s.sumJ2 / t) : null;
    const rmsAccel = t > 0 ? Math.sqrt(s.sumA2 / t) : null;
    const rmsLateral = t > 0 ? Math.sqrt(s.sumL2 / t) : null;
    const harsh = s.events.brake + s.events.accel + s.events.lateral;
    const km = s.distance / 1000;
    const harshPer10km = km > 0 ? (harsh / km) * 10 : 0;
    return {
      analysisVersion: ANALYSIS_VERSION,
      startedAt: s.first ? s.first.t : null,
      endedAt: s.last ? s.last.t : null,
      duration: s.first ? (s.last.t - s.first.t) / 1000 : 0,
      distance: s.distance,
      movingTime: t,
      avgSpeed: t > 0 ? s.distance / t : 0,
      maxSpeed: s.maxSpeed,
      rmsJerk,
      rmsAccel,
      rmsLateral,
      events: { ...s.events },
      eventLog: s.eventLog.slice(),
      harsh,
      harshPer10km,
      brakeLossPerKm: km > 0 ? s.brakeLoss / km : 0,
      stops: s.stops,
      stopsPerKm: km > 0 ? s.stops / km : 0,
      // Too short to judge: no score rather than a misleading one.
      score: t >= 30 && km >= 0.2 ? scoreFrom({ rmsJerk, rmsAccel, harshPer10km }) : null,
    };
  }

  return { push, live, summary };
}

/** Analyse a whole list of fixes (GPX import, re-scoring). Same code path as live. */
export function analyzeFixes(fixes, options) {
  const an = createAnalyzer(options);
  for (const f of fixes) an.push(f);
  return an.summary();
}
