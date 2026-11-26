// Drive records as stored on the phone. Fixes are kept as compact arrays
// [t, lat, lon, speed|null, accuracy|null, altitude|null] to keep storage and exports small.
// Altitude (m) was added in 1.1; older drives have 5-element fixes and read as null.
import { analyzeFixes, ANALYSIS_VERSION } from "./analysis.js";
import { summarizeCar, isValidRows } from "./car.js";
import { buildRibbon } from "./track.js";
import { courseDifficulty } from "./difficulty.js";

export const round = (n, digits) => (n == null ? null : Number(n.toFixed(digits)));

export function packFix(f) {
  return [
    f.t,
    round(f.lat, 6),
    round(f.lon, 6),
    round(f.speed, 2),
    round(f.accuracy, 1),
    round(f.altitude ?? null, 1),
  ];
}

export function unpackFix(a) {
  return {
    t: a[0],
    lat: a[1],
    lon: a[2],
    speed: a[3] ?? null,
    accuracy: a[4] ?? null,
    altitude: a[5] ?? null,
  };
}

export function makeDrive({ id, source, name = null, fixes = [], now = Date.now() }) {
  return {
    id: id || `d${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source, // "live" | "gpx" | "demo"
    name,
    createdAt: now,
    inProgress: source === "live",
    fixes: fixes.map(packFix),
    summary: null,
  };
}

/** (Re)compute a drive's summary with the current analysis. Returns a new record. */
export function finalizeDrive(drive) {
  const fixes = drive.fixes.map(unpackFix);
  const summary = analyzeFixes(fixes);
  // Car (OBD) data, if an adapter was connected: fuel per GPS distance, RPM, throttle.
  summary.car = drive.obd ? summarizeCar(drive.obd, summary.distance) : null;
  // Where along the drive it went firm or harsh (the strip under each drive in History).
  summary.ribbon = buildRibbon(fixes);
  // How hard the road was (0-10), shown next to the score; never changes it.
  summary.course = courseDifficulty(fixes);
  return { ...drive, inProgress: false, summary };
}

export function needsRescore(drive) {
  return (
    !drive.inProgress && (!drive.summary || drive.summary.analysisVersion !== ANALYSIS_VERSION)
  );
}

/** Validate a drive coming from an import file. */
export function isValidDrive(d) {
  return (
    d &&
    typeof d === "object" &&
    typeof d.id === "string" &&
    d.id.length > 0 &&
    d.id.length < 100 &&
    (d.source === "live" || d.source === "gpx" || d.source === "demo") &&
    Array.isArray(d.fixes) &&
    (d.obd == null || isValidRows(d.obd)) &&
    d.fixes.every(
      (f) =>
        Array.isArray(f) &&
        Number.isFinite(f[0]) &&
        Number.isFinite(f[1]) &&
        Number.isFinite(f[2]) &&
        Math.abs(f[1]) <= 90 &&
        Math.abs(f[2]) <= 180,
    )
  );
}

export function sortDrives(drives) {
  const start = (d) => (d.fixes.length ? d.fixes[0][0] : d.createdAt);
  return drives.slice().sort((a, b) => start(b) - start(a));
}
