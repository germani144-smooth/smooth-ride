// Car (OBD) data in drives: compact rows, the drive's fuel summary and live consumption.
import { ROW, ROW_LENGTH_BEFORE_PEDAL } from "./elm.js";

const IDX = Object.fromEntries(ROW.map((k, i) => [k, i]));
const MAX_GAP = 5; // s; longer gaps between rows are not integrated

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

export function packRow(row) {
  return [
    row.t,
    r1(row.speed),
    row.rpm == null ? null : Math.round(row.rpm),
    r2(row.maf),
    r1(row.throttle),
    r1(row.load),
    row.coolant == null ? null : Math.round(row.coolant),
    row.fuelRate == null ? null : Math.round(row.fuelRate * 1000) / 1000,
    r1(row.pedal),
  ];
}

export function isValidRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.every(
      (r) =>
        Array.isArray(r) &&
        r.length >= ROW_LENGTH_BEFORE_PEDAL &&
        r.length <= ROW.length &&
        Number.isFinite(r[0]) &&
        r.slice(1).every((x) => x === null || Number.isFinite(x)),
    )
  );
}

/**
 * Summary of a drive's car data. `distance` (m) is the drive's GPS distance, so consumption
 * per 100 km uses the same distance as everything else. Returns null without rows.
 */
export function summarizeCar(rows, distance) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  let litres = 0;
  let idleLitres = 0;
  let fuelTime = 0;
  let rpmSum = 0;
  let rpmN = 0;
  let maxRpm = null;
  let thrSum = 0;
  let thrN = 0;
  let maxThrottle = null;
  let coldTime = 0;
  let time = 0;
  let firstCoolant = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rpm = r[IDX.rpm];
    // Throttle stats: the valve when it was read, else the pedal (cars with PID 49 skip 11).
    const thr = r[IDX.throttle] ?? r[IDX.pedal] ?? null;
    const cool = r[IDX.coolant];
    if (rpm != null) {
      rpmSum += rpm;
      rpmN++;
      maxRpm = Math.max(maxRpm ?? 0, rpm);
    }
    if (thr != null) {
      thrSum += thr;
      thrN++;
      maxThrottle = Math.max(maxThrottle ?? 0, thr);
    }
    if (cool != null && firstCoolant == null) firstCoolant = cool;
    if (i === 0) continue;
    const p = rows[i - 1];
    const dt = (r[0] - p[0]) / 1000;
    if (!(dt > 0) || dt > MAX_GAP) continue;
    time += dt;
    if (cool != null && cool < 70) coldTime += dt;
    const f0 = p[IDX.fuelRate];
    const f1 = r[IDX.fuelRate];
    if (f0 != null && f1 != null) {
      const l = (((f0 + f1) / 2) * dt) / 3600;
      litres += l;
      fuelTime += dt;
      const s0 = p[IDX.speed];
      const s1 = r[IDX.speed];
      if (s0 != null && s1 != null && s0 < 1 && s1 < 1) idleLitres += l;
    }
  }
  const hasFuel = fuelTime > 0;
  const km = distance / 1000;
  return {
    litres: hasFuel ? litres : null,
    lPer100km: hasFuel && km >= 0.2 ? (litres / km) * 100 : null,
    idleLitres: hasFuel ? idleLitres : null,
    avgRpm: rpmN ? rpmSum / rpmN : null,
    maxRpm,
    avgThrottle: thrN ? thrSum / thrN : null,
    maxThrottle,
    coldShare: time > 0 ? coldTime / time : null, // share of time with coolant under 70 °C
    startCoolant: firstCoolant,
  };
}

/**
 * Live consumption, smoothed: L/100 km while moving, L/h when (nearly) stopped, where per
 * distance means nothing. Feed rows one at a time.
 */
export function createConsumption({ tau = 3 } = {}) {
  let rate = null; // L/h, smoothed
  let speed = null;
  let last = null;
  return {
    push(row) {
      if (row.fuelRate == null) return this.value();
      const dt = last ? Math.max(0, (row.t - last) / 1000) : 0;
      const a = rate == null ? 1 : 1 - Math.exp(-dt / tau);
      rate = rate == null ? row.fuelRate : rate + a * (row.fuelRate - rate);
      if (row.speed != null) speed = speed == null ? row.speed : speed + a * (row.speed - speed);
      last = row.t;
      return this.value();
    },
    value() {
      if (rate == null) return null;
      if (speed != null && speed >= 5) return { value: (rate / speed) * 100, unit: "L/100" };
      return { value: rate, unit: "L/h" };
    },
  };
}

/**
 * Throttle as the driver feels it, 0-100 %, from the raw pedal or throttle-valve reading.
 * Neither reads 0 at rest (a pedal sensor sits around 15 %, a valve opens for idle) nor 100 at
 * the floor, so: rest is the lowest reading seen, full the highest, but at least `span` above
 * rest until the pedal has actually been floored. Feed raw readings one at a time.
 */
export const THROTTLE_SPAN = 65; // raw % points between rest and floor until seen

export function createThrottleScale({ span = THROTTLE_SPAN } = {}) {
  let rest = null;
  let highest = null;
  return {
    push(raw) {
      if (raw == null || !Number.isFinite(raw)) return null;
      rest = rest == null ? raw : Math.min(rest, raw);
      highest = highest == null ? raw : Math.max(highest, raw);
      const full = Math.max(highest, rest + span);
      return Math.max(0, Math.min(100, ((raw - rest) / (full - rest)) * 100));
    },
  };
}
