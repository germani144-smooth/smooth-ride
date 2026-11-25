// Turns a drive's fixes into what the map draws: the route split into coloured runs
// (smooth / firm / harsh), start and finish, and the harsh events. It uses the same
// analyzer as the score, so the map and the numbers always agree.
import { createAnalyzer, DEFAULTS } from "./analysis.js";
import { distance } from "./geo.js";

export const LEVELS = ["smooth", "firm", "harsh"];

// Firm: noticeable but fine. Harsh: the same thresholds that count a harsh event.
export const FIRM = { accel: 1.0, lateral: 1.5 };

/** 0 = smooth, 1 = firm, 2 = harsh, from longitudinal and lateral acceleration (m/s²). */
export function levelFor(accel, lateral, options = DEFAULTS) {
  const { harshBrake, harshAccel, harshLateral } = options;
  if (accel <= harshBrake || accel >= harshAccel || Math.abs(lateral) >= harshLateral) return 2;
  if (Math.abs(accel) >= FIRM.accel || Math.abs(lateral) >= FIRM.lateral) return 1;
  return 0;
}

/**
 * Build the map track. Returns { runs: [{ level, points: [[lat, lon], ...] }], start, end,
 * events: [{ kind, lat, lon, t }], bounds: [[south, west], [north, east]] } or null if
 * there is nothing to draw. Signal gaps break the line instead of drawing a straight jump.
 */
export function buildTrack(fixes, options) {
  const o = { ...DEFAULTS, ...options };
  const an = createAnalyzer(options);
  const runs = [];
  const events = [];
  let prev = null;
  let run = null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  let first = null;

  for (const f of fixes) {
    const sample = an.push(f);
    if (!sample) continue;
    const pt = [f.lat, f.lon];
    south = Math.min(south, f.lat);
    north = Math.max(north, f.lat);
    west = Math.min(west, f.lon);
    east = Math.max(east, f.lon);
    if (!first) first = pt;
    if (sample.event) events.push({ kind: sample.event, lat: f.lat, lon: f.lon, t: f.t });

    const gap = prev && (f.t - prev.t) / 1000 > o.maxGap;
    if (prev && !gap) {
      const level = levelFor(sample.accel, sample.lateral, o);
      if (!run || run.level !== level) {
        run = { level, points: [[prev.lat, prev.lon]] };
        runs.push(run);
      }
      run.points.push(pt);
    } else {
      run = null; // start fresh after a gap
    }
    prev = f;
  }

  if (!first || !prev) return null;
  return {
    runs,
    start: first,
    end: [prev.lat, prev.lon],
    events,
    bounds: [
      [south, west],
      [north, east],
    ],
  };
}

/** Number of buckets in a drive's ribbon (stored in each drive's summary). */
export const RIBBON_BUCKETS = 60;

/**
 * A drive's smoothness along its distance, for the strip under each drive in History:
 * `buckets` levels from start to finish, each the worst level (0 smooth, 1 firm, 2 harsh)
 * driven in that stretch, or -1 where there's no data (a tunnel, a gap). Same analyzer as
 * the score and the map, so all three agree.
 */
export function buildRibbon(fixes, buckets = RIBBON_BUCKETS, options) {
  const o = { ...DEFAULTS, ...options };
  const an = createAnalyzer(options);
  const marks = []; // [distance at the middle of the hop, level]
  let travelled = 0;
  let prev = null;
  for (const f of fixes) {
    const sample = an.push(f);
    if (!sample) continue;
    if (prev) {
      const hop = distance(prev.lat, prev.lon, f.lat, f.lon);
      const gap = (f.t - prev.t) / 1000 > o.maxGap;
      if (!gap) {
        const level = sample.event ? 2 : levelFor(sample.accel, sample.lateral, o);
        marks.push([travelled + hop / 2, level]);
      }
      travelled += hop;
    }
    prev = f;
  }
  const levels = new Array(buckets).fill(-1);
  if (travelled <= 0) return levels;
  for (const [at, level] of marks) {
    const i = Math.min(buckets - 1, Math.floor((at / travelled) * buckets));
    levels[i] = Math.max(levels[i], level);
  }
  return levels;
}
