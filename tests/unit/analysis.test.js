import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnalyzer, analyzeFixes, scoreFrom } from "../../js/core/analysis.js";
import { distance, bearing, wrapAngle } from "../../js/core/geo.js";
import { parseGpx } from "../../js/core/gpx.js";
import {
  makeDrive,
  finalizeDrive,
  packFix,
  unpackFix,
  isValidDrive,
  needsRescore,
  sortDrives,
} from "../../js/core/drives.js";
import { fmtDistance, fmtDuration, fmtSpeed, scoreClass } from "../../js/core/format.js";

const M_PER_DEG = 111195;

/** Straight drive north at 1 Hz; speedAt(sec) gives m/s. Synthetic, not a real place. */
function straightDrive(seconds, speedAt, { withSpeed = true, t0 = 1_700_000_000_000 } = {}) {
  const fixes = [];
  let lat = 10;
  for (let i = 0; i <= seconds; i++) {
    const v = speedAt(i);
    if (i > 0) lat += ((speedAt(i - 1) + v) / 2 / M_PER_DEG) * 1;
    fixes.push({ t: t0 + i * 1000, lat, lon: 20, speed: withSpeed ? v : null, accuracy: 5 });
  }
  return fixes;
}

/** Drive at constant speed around a circle of the given radius. */
function circleDrive(seconds, v, radius) {
  const fixes = [];
  const w = v / radius;
  for (let i = 0; i <= seconds; i++) {
    const th = w * i;
    fixes.push({
      t: 1_700_000_000_000 + i * 1000,
      lat: 10 + (radius * Math.sin(th)) / M_PER_DEG,
      lon: 20 + (radius * (1 - Math.cos(th))) / (M_PER_DEG * Math.cos((10 * Math.PI) / 180)),
      speed: v,
      accuracy: 5,
    });
  }
  return fixes;
}

test("geo: distance and bearing", () => {
  assert.ok(Math.abs(distance(10, 20, 10 + (1 / M_PER_DEG) * 1000, 20) - 1000) < 1);
  assert.ok(Math.abs(bearing(10, 20, 10.01, 20)) < 1e-9);
  assert.ok(Math.abs(bearing(10, 20, 10, 20.01) - Math.PI / 2) < 1e-3);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle((-3 * Math.PI) / 2) - Math.PI / 2) < 1e-9);
});

test("score is monotonic and bounded", () => {
  assert.equal(scoreFrom({ rmsJerk: 0, rmsAccel: 0 }), 100);
  assert.ok(
    scoreFrom({ rmsJerk: 0.3, rmsAccel: 0.5 }) > scoreFrom({ rmsJerk: 1.5, rmsAccel: 1.5 }),
  );
  assert.equal(scoreFrom({ rmsJerk: 100, rmsAccel: 100 }), 0);
});

test("steady cruise: no harsh events, high score, right distance", () => {
  const s = analyzeFixes(straightDrive(120, () => 15));
  assert.equal(s.harsh, 0);
  assert.ok(s.score >= 95, `score ${s.score}`);
  assert.ok(Math.abs(s.distance - 1800) < 5, `distance ${s.distance}`);
  assert.equal(s.stops, 0);
});

test("hard stop scores worse than a gentle stop and counts a harsh brake", () => {
  const cruise = 60;
  const hard = straightDrive(120, (t) => (t < cruise ? 20 : Math.max(0, 20 - 6 * (t - cruise))));
  const gentle = straightDrive(120, (t) =>
    t < cruise ? 20 : Math.max(0, 20 - 0.8 * (t - cruise)),
  );
  const h = analyzeFixes(hard);
  const g = analyzeFixes(gentle);
  assert.ok(h.events.brake >= 1, "hard brake detected");
  assert.equal(g.events.brake, 0, "gentle stop is not harsh");
  assert.ok(h.score < g.score, `hard ${h.score} vs gentle ${g.score}`);
  assert.ok(h.rmsJerk > g.rmsJerk);
  assert.equal(h.stops, 1);
  assert.equal(g.stops, 1);
  // Both shed the same speed to braking.
  assert.ok(Math.abs(h.brakeLossPerKm - g.brakeLossPerKm) / g.brakeLossPerKm < 0.6);
});

test("a single long hard brake is one event, not several", () => {
  const s = analyzeFixes(
    straightDrive(60, (t) => (t < 20 ? 30 : Math.max(0, 30 - 3.5 * (t - 20)))),
  );
  assert.equal(s.events.brake, 1);
});

test("hard acceleration counts as harsh", () => {
  const s = analyzeFixes(straightDrive(60, (t) => (t < 10 ? 0 : Math.min(25, 4 * (t - 10)))));
  assert.ok(s.events.accel >= 1);
});

test("fast tight corner counts a lateral event, a gentle one does not", () => {
  assert.ok(analyzeFixes(circleDrive(40, 15, 50)).events.lateral >= 1); // 4.5 m/s²
  assert.equal(analyzeFixes(circleDrive(40, 10, 200)).events.lateral, 0); // 0.5 m/s²
});

test("works without reported speed (GPX without <speed>)", () => {
  const s = analyzeFixes(straightDrive(120, () => 15, { withSpeed: false }));
  assert.equal(s.harsh, 0);
  assert.ok(s.score >= 90, `score ${s.score}`);
});

test("signal gap resets kinematics instead of faking a harsh event", () => {
  const a = straightDrive(60, () => 20);
  const b = straightDrive(60, () => 5, { t0: a.at(-1).t + 30_000 });
  b.forEach((f) => (f.lat += a.at(-1).lat - 10 + 0.01));
  const s = analyzeFixes([...a, ...b]);
  assert.equal(s.events.brake, 0);
  assert.ok(s.distance > 1200 + 300);
});

test("inaccurate fixes are ignored", () => {
  const fixes = straightDrive(60, () => 15);
  fixes[30] = { ...fixes[30], lat: fixes[30].lat + 0.01, accuracy: 500 };
  const s = analyzeFixes(fixes);
  assert.equal(s.harsh, 0);
  assert.ok(Math.abs(s.distance - 900) < 5);
});

test("too-short drive gets no score", () => {
  assert.equal(analyzeFixes(straightDrive(10, () => 10)).score, null);
});

test("live window gives a rolling score and running counts", () => {
  const an = createAnalyzer();
  const fixes = straightDrive(30, () => 12);
  fixes.forEach((f) => an.push(f));
  const l = an.live();
  assert.ok(l.score >= 95);
  assert.equal(l.harsh, 0);
  assert.ok(Math.abs(l.speed - 12) < 0.01);
});

test("streaming push gives the same summary as analyzeFixes", () => {
  const fixes = straightDrive(90, (t) => 10 + 5 * Math.sin(t / 5));
  const an = createAnalyzer();
  fixes.forEach((f) => an.push(f));
  assert.deepEqual(an.summary(), analyzeFixes(fixes));
});

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns:gpxtpx="http://example.com/x">
  <metadata><name>Meta</name></metadata>
  <trk><name>Test &amp; drive</name><trkseg>
    <trkpt lon="20" lat="10"><time>2026-01-01T10:00:00Z</time><extensions><gpxtpx:speed>12.5</gpxtpx:speed></extensions></trkpt>
    <trkpt lat="10.0001" lon="20"><ele>3</ele><time>2026-01-01T10:00:01Z</time></trkpt>
    <trkpt lat="10.0002" lon="20"/>
    <trkpt lat="10.0003" lon="20"><time>2026-01-01T10:00:02.500Z</time><speed>11</speed></trkpt>
  </trkseg></trk>
</gpx>`;

test("gpx: parses points in any attribute order, namespaced speed, skips untimed", () => {
  const { name, fixes } = parseGpx(GPX);
  assert.equal(name, "Test & drive");
  assert.equal(fixes.length, 3);
  assert.deepEqual(fixes[0], {
    t: Date.parse("2026-01-01T10:00:00Z"),
    lat: 10,
    lon: 20,
    speed: 12.5,
    accuracy: null,
  });
  assert.equal(fixes[1].speed, null);
  assert.equal(fixes[2].speed, 11);
  assert.equal(fixes[2].t - fixes[0].t, 2500);
});

test("gpx: rejects non-GPX and empty tracks", () => {
  assert.throws(() => parseGpx("<kml></kml>"), /not a GPX/);
  assert.throws(() => parseGpx("<gpx><trk></trk></gpx>"), /No timed track points/);
});

test("drives: pack, validate, finalize, rescore flag, sort", () => {
  const fixes = straightDrive(60, () => 15);
  const f = fixes[3];
  assert.deepEqual(unpackFix(packFix(f)), { ...f, lat: Number(f.lat.toFixed(6)) });
  const d = makeDrive({ source: "gpx", fixes, now: 1 });
  assert.equal(d.inProgress, false);
  assert.ok(isValidDrive(d));
  assert.ok(needsRescore(d));
  const done = finalizeDrive(d);
  assert.equal(needsRescore(done), false);
  assert.ok(done.summary.score >= 95);
  assert.equal(makeDrive({ source: "live" }).inProgress, true);
  assert.equal(isValidDrive({ ...d, source: "x" }), false);
  assert.equal(isValidDrive({ ...d, fixes: [[1, 95, 0]] }), false);
  const older = makeDrive({ source: "gpx", fixes: straightDrive(5, () => 1, { t0: 1000 }) });
  assert.deepEqual(
    sortDrives([older, d]).map((x) => x.id),
    [d.id, older.id],
  );
});

test("format helpers", () => {
  assert.equal(fmtDistance(850), "850 m");
  assert.equal(fmtDistance(12345), "12.3 km");
  assert.equal(fmtDuration(3725), "1:02:05");
  assert.equal(fmtDuration(65), "1:05");
  assert.equal(fmtSpeed(10), "36");
  assert.equal(scoreClass(80), "good");
  assert.equal(scoreClass(60), "ok");
  assert.equal(scoreClass(20), "poor");
  assert.equal(scoreClass(null), "");
});

// ---- Sideways acceleration: cases found in the first real drive (synthetic here) ----

/** A path from per-second [speed m/s, heading°] pairs; t0 offsets allow gaps. */
function pathDrive(steps, { t0 = 1_700_000_000_000, gapAt = null, gapSeconds = 0 } = {}) {
  const fixes = [];
  let x = 0;
  let y = 0;
  let t = t0;
  const cos = Math.cos((10 * Math.PI) / 180);
  steps.forEach(([v, hdg], i) => {
    const step = i === gapAt ? gapSeconds : 1;
    const h = (hdg * Math.PI) / 180;
    x += v * step * Math.sin(h);
    y += v * step * Math.cos(h);
    t += step * 1000;
    fixes.push({
      t,
      lat: 10 + y / M_PER_DEG,
      lon: 20 + x / (M_PER_DEG * cos),
      speed: v,
      accuracy: 4,
    });
  });
  return fixes;
}

test("turning slowly, then speeding up, is not a sharp corner (stale heading)", () => {
  // Drive west at 15 m/s, slow to 2 m/s and turn 180° slowly, then pull away east.
  const steps = [];
  for (let i = 0; i < 20; i++) steps.push([15, -90]);
  for (let i = 0; i < 10; i++) steps.push([15 - 1.3 * i, -90]);
  for (let i = 0; i < 18; i++) steps.push([2, -90 + 10 * i]);
  for (let i = 0; i < 15; i++) steps.push([2 + i, 90]);
  assert.equal(analyzeFixes(pathDrive(steps)).events.lateral, 0);
});

test("the first seconds after a tunnel are not a sharp corner", () => {
  // Gentle bend through a 10 s tunnel: the chord across the gap must not count as a swerve.
  const steps = [];
  for (let i = 0; i < 20; i++) steps.push([22, -85]);
  steps.push([22, -100]); // the hop across the gap
  for (let i = 0; i < 20; i++) steps.push([22, -110 - i * 1.5]);
  const s = analyzeFixes(pathDrive(steps, { gapAt: 20, gapSeconds: 10 }));
  assert.equal(s.events.lateral, 0);
});

test("one jittery heading in a real turn doesn't make it harsh", () => {
  // A ~17°/s turn at 7 m/s (about 2 m/s² sideways) with one 41° jump in the middle.
  const headings = [-113, -98, -78, -56, -35, -31, 10, 8, 16, 33, 50];
  const steps = [];
  for (let i = 0; i < 10; i++) steps.push([7, -113]);
  headings.forEach((h) => steps.push([7, h]));
  for (let i = 0; i < 10; i++) steps.push([7, 50]);
  assert.equal(analyzeFixes(pathDrive(steps)).events.lateral, 0);
});

test("a sustained fast loop still counts as a sharp corner", () => {
  // 20°/s at 9.5 m/s for 15 s: 3.3 m/s² sideways, held.
  const steps = [];
  for (let i = 0; i < 10; i++) steps.push([9.5, 0]);
  for (let i = 1; i <= 15; i++) steps.push([9.5, 20 * i]);
  for (let i = 0; i < 10; i++) steps.push([9.5, 300]);
  assert.equal(analyzeFixes(pathDrive(steps)).events.lateral, 1);
});
