// Course difficulty, 0.0 to 10.0: how hard the road itself makes it to drive smoothly. Shown
// next to the score; it never changes the score. Only the road's shape counts, never speed,
// so driving faster or slower can't change it. Three parts, each ignoring a baseline every
// road has (floor) and levelling off so the total stays under 10:
//   turning (up to 4.5)  how many degrees the road turns per km, tight bends counted twice
//   bends (up to 3)      how many separate bends (20° or more) per km: an S-bend is two
//   hills (up to 2.5)    metres up plus metres down per km (only drives recorded with
//                        altitude, 1.1+, or GPX files with elevation)
// Calibrated on Madeira (town 6.4, expressway 5.5, VR1 motorway 5.0 before hills; hills add
// about 1 to 2 there) and simulated Danish roads (motorway 0 to 1, country road about 1).
// Pure: works on unpacked fixes { t, lat, lon, speed, accuracy, altitude }.
import { distance, bearing, wrapAngle } from "./geo.js";

export const DIFFICULTY = {
  minDistance: 1000, // m; shorter drives get no difficulty
  maxAccuracy: 30, // m; worse fixes are left out
  maxGap: 10, // s; a longer gap (tunnel) breaks the track
  step: 25, // m between resampled points; headings come from these chords
  stepsPerWindow: 4, // turns are added up signed over 100 m, so GPS wobble cancels out
  minTurnSpeed: 2, // m/s; standing still, the heading is noise (not used for difficulty)
  turnNoise: 8, // degrees per 100 m ignored (radius over about 700 m: a motorway curve)
  sharpTurn: 60, // degrees per 100 m: a radius under about 95 m counts twice
  minBend: 20, // degrees; a bend counts once it has turned this far
  altitudeSmoothing: 150, // m of road; GPS altitude is noisy (per metre, so speed can't matter)
  hillDeadBand: 5, // m; altitude must move this far up or down to count
  turning: { max: 4.5, floor: 30, scale: 80 }, // degrees per km
  bends: { max: 3, floor: 0.3, scale: 1.2 }, // bends per km
  hills: { max: 2.5, floor: 2, scale: 30 }, // m up + down per km
};

/** Each part saturates: max · (1 − e^(−(value − floor)/scale)). */
export const part = (value, { max, floor, scale }) =>
  max * (1 - Math.exp(-Math.max(0, value - floor) / scale));

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Returns { difficulty, turning, bends, hills, turningPerKm, bendsPerKm, hillsPerKm } or null
 * for drives under 1 km. hills and hillsPerKm are null without altitude.
 */
export function courseDifficulty(allFixes, options = DIFFICULTY) {
  const fixes = allFixes.filter((f) => f.accuracy == null || f.accuracy <= options.maxAccuracy);
  let metres = 0;
  let turning = 0; // degrees
  let bendCount = 0;
  let upAndDown = 0; // m
  let hasAltitude = false;

  let previous = null;
  let points = []; // resampled points of the current unbroken stretch
  let sinceLast = 0;
  let altitudeAverage = null;
  let altitudeAnchor = null; // smoothed altitude at the last counted rise or fall

  let windowTurn = 0; // signed degrees in the current 100 m window
  let windowSteps = 0;
  let bendDirection = 0; // -1 left, 1 right, 0 not in a bend
  let bendTurn = 0; // degrees turned so far in the current bend
  let bendCounted = false;

  const closeWindow = () => {
    const change = Math.abs(windowTurn);
    if (change > options.turnNoise) {
      turning += change > options.sharpTurn ? 2 * change : change;
      // A new bend starts when the road starts turning, or turns the other way; it counts
      // once it has turned minBend degrees, so GPS wobble doesn't make bends.
      const direction = Math.sign(windowTurn);
      if (direction !== bendDirection) {
        bendTurn = 0;
        bendCounted = false;
      }
      bendDirection = direction;
      bendTurn += change;
      if (!bendCounted && bendTurn >= options.minBend) {
        bendCount++;
        bendCounted = true;
      }
    } else {
      bendDirection = 0;
    }
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
    let stepMetres = 0;
    if (previous && interval > options.maxGap) {
      // A gap: start a fresh stretch, don't join across it.
      closeWindow();
      bendDirection = 0;
      points = [];
      sinceLast = 0;
      altitudeAverage = null;
      altitudeAnchor = null;
      previous = null;
    }
    if (previous) {
      stepMetres = distance(previous.lat, previous.lon, fix.lat, fix.lon);
      metres += stepMetres;
      sinceLast += stepMetres;
    }
    if (!points.length || sinceLast >= options.step) {
      points.push(fix);
      sinceLast = 0;
      if (points.length >= 3) addTurn();
    }

    if (fix.altitude != null) {
      hasAltitude = true;
      altitudeAverage =
        altitudeAverage == null
          ? fix.altitude
          : altitudeAverage +
            (1 - Math.exp(-stepMetres / options.altitudeSmoothing)) *
              (fix.altitude - altitudeAverage);
      if (altitudeAnchor == null) altitudeAnchor = altitudeAverage;
      // Count rises and falls once they pass the dead band, so noise around a level road
      // adds nothing.
      if (Math.abs(altitudeAverage - altitudeAnchor) >= options.hillDeadBand) {
        upAndDown += Math.abs(altitudeAverage - altitudeAnchor);
        altitudeAnchor = altitudeAverage;
      }
    }
    previous = fix;
  }

  closeWindow();
  if (metres < options.minDistance) return null;
  const km = metres / 1000;
  const turningPerKm = turning / km;
  const bendsPerKm = bendCount / km;
  const hillsPerKm = hasAltitude ? upAndDown / km : null;
  const turningPart = part(turningPerKm, options.turning);
  const bendsPart = part(bendsPerKm, options.bends);
  const hillsPart = hillsPerKm == null ? 0 : part(hillsPerKm, options.hills);
  return {
    difficulty: round1(turningPart + bendsPart + hillsPart),
    turning: round1(turningPart),
    bends: round1(bendsPart),
    hills: hillsPerKm == null ? null : round1(hillsPart),
    turningPerKm: Math.round(turningPerKm),
    bendsPerKm: round1(bendsPerKm),
    hillsPerKm: hillsPerKm == null ? null : round1(hillsPerKm),
  };
}
