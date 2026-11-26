// Course difficulty, 0.0 to 10.0: how hard the road made it to drive smoothly. Shown next to
// the score; it never changes the score. Three parts, each ignoring a baseline every road has
// (floor) and levelling off so the total stays under 10:
//   bends (up to 5)          how much the road turns per km, sharp turns counted twice
//   speed changes (up to 3)  how much the speed the road allows swings per km (limits,
//                            junctions, stop-and-go); GPS can't see limits, this is the proxy
//   climb (up to 2)          metres climbed per km (only drives recorded with altitude, 1.1+)
// Pure: works on unpacked fixes { t, lat, lon, speed, accuracy, altitude }.
import { distance, bearing, wrapAngle } from "./geo.js";

export const DIFFICULTY = {
  minDistance: 1000, // m; shorter drives get no difficulty
  maxAccuracy: 30, // m; worse fixes are left out
  maxGap: 10, // s; a longer gap (tunnel) breaks the track
  step: 25, // m between resampled points; headings come from these chords
  stepsPerWindow: 4, // turns are added up signed over 100 m, so GPS wobble cancels out
  minTurnSpeed: 2, // m/s; slower and the heading is noise
  turnNoise: 8, // degrees per 100 m ignored (radius over about 700 m: a motorway curve)
  sharpTurn: 60, // degrees per 100 m: a radius under about 95 m counts twice
  speedSmoothing: 20, // s; the speed the road sets, not each pedal input
  climbDeadBand: 5, // m; altitude must move this far to count (GPS altitude is noisy)
  altitudeSmoothing: 15, // s
  bends: { max: 5, floor: 60, scale: 200 }, // degrees per km
  speed: { max: 3, floor: 5, scale: 60 }, // km/h of swing per km
  climb: { max: 2, floor: 0, scale: 30 }, // m per km
};

/** Each part saturates: max · (1 − e^(−(value − floor)/scale)). */
export const part = (value, { max, floor, scale }) =>
  max * (1 - Math.exp(-Math.max(0, value - floor) / scale));

const round1 = (n) => Math.round(n * 10) / 10;

/** Returns { difficulty, bends, speed, climb, turningPerKm, swingPerKm, climbPerKm } or null. */
export function courseDifficulty(allFixes, options = DIFFICULTY) {
  const fixes = allFixes.filter((f) => f.accuracy == null || f.accuracy <= options.maxAccuracy);
  let metres = 0;
  let turning = 0; // degrees
  let swing = 0; // m/s
  let climb = 0; // m
  let hasAltitude = false;

  let previous = null;
  let points = []; // resampled points of the current unbroken stretch
  let sinceLast = 0;
  let speedAverage = null;
  let altitudeAverage = null;
  let altitudeLow = null; // lowest smoothed altitude since the last counted climb

  let windowTurn = 0; // signed degrees in the current 100 m window
  let windowSteps = 0;

  const closeWindow = () => {
    const change = Math.abs(windowTurn);
    if (change > options.turnNoise) turning += change > options.sharpTurn ? 2 * change : change;
    windowTurn = 0;
    windowSteps = 0;
  };

  const addTurn = () => {
    const [a, m, c] = points.slice(-3);
    windowSteps++;
    if ((m.speed ?? options.minTurnSpeed) >= options.minTurnSpeed) {
      const change = wrapAngle(
        bearing(m.lat, m.lon, c.lat, c.lon) - bearing(a.lat, a.lon, m.lat, m.lon),
      );
      windowTurn += (change * 180) / Math.PI;
    }
    if (windowSteps >= options.stepsPerWindow) closeWindow();
  };

  for (const fix of fixes) {
    const interval = previous ? (fix.t - previous.t) / 1000 : 0;
    if (previous && interval > options.maxGap) {
      // A gap: start a fresh stretch, don't join across it.
      closeWindow();
      points = [];
      sinceLast = 0;
      speedAverage = null;
      altitudeAverage = null;
      altitudeLow = null;
      previous = null;
    }
    if (previous) {
      const step = distance(previous.lat, previous.lon, fix.lat, fix.lon);
      metres += step;
      sinceLast += step;
    }
    if (!points.length || sinceLast >= options.step) {
      points.push(fix);
      sinceLast = 0;
      if (points.length >= 3) addTurn();
    }

    if (fix.speed != null) {
      const before = speedAverage;
      speedAverage =
        before == null
          ? fix.speed
          : before + (1 - Math.exp(-interval / options.speedSmoothing)) * (fix.speed - before);
      if (before != null) swing += Math.abs(speedAverage - before);
    }

    if (fix.altitude != null) {
      hasAltitude = true;
      altitudeAverage =
        altitudeAverage == null
          ? fix.altitude
          : altitudeAverage +
            (1 - Math.exp(-interval / options.altitudeSmoothing)) *
              (fix.altitude - altitudeAverage);
      if (altitudeLow == null || altitudeAverage < altitudeLow) altitudeLow = altitudeAverage;
      if (altitudeAverage - altitudeLow >= options.climbDeadBand) {
        climb += altitudeAverage - altitudeLow;
        altitudeLow = altitudeAverage;
      }
    }
    previous = fix;
  }

  closeWindow();
  if (metres < options.minDistance) return null;
  const km = metres / 1000;
  const turningPerKm = turning / km;
  const swingPerKm = (swing * 3.6) / km;
  const climbPerKm = hasAltitude ? climb / km : null;
  const bends = part(turningPerKm, options.bends);
  const speed = part(swingPerKm, options.speed);
  const climbPart = climbPerKm == null ? 0 : part(climbPerKm, options.climb);
  return {
    difficulty: round1(bends + speed + climbPart),
    bends: round1(bends),
    speed: round1(speed),
    climb: climbPerKm == null ? null : round1(climbPart),
    turningPerKm: Math.round(turningPerKm),
    swingPerKm: Math.round(swingPerKm),
    climbPerKm: climbPerKm == null ? null : round1(climbPerKm),
  };
}
