import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrack, levelFor } from "../../js/core/track.js";
import { analyzeFixes } from "../../js/core/analysis.js";

const M_PER_DEG = 111195;

/** Synthetic straight drive north at 1 Hz (open sea, not a real place). */
function drive(seconds, speedAt, t0 = 1_700_000_000_000) {
  const fixes = [];
  let lat = 0.5;
  for (let i = 0; i <= seconds; i++) {
    if (i > 0) lat += (speedAt(i - 1) + speedAt(i)) / 2 / M_PER_DEG;
    fixes.push({ t: t0 + i * 1000, lat, lon: 0.5, speed: speedAt(i), accuracy: 5 });
  }
  return fixes;
}

test("levelFor uses the harsh-event thresholds and a firm band", () => {
  assert.equal(levelFor(0.3, 0.2), 0);
  assert.equal(levelFor(-1.2, 0), 1);
  assert.equal(levelFor(0, 1.6), 1);
  assert.equal(levelFor(-2.6, 0), 2);
  assert.equal(levelFor(2.1, 0), 2);
  assert.equal(levelFor(0, -3.2), 2);
});

test("a steady drive is one smooth run with start, end and bounds", () => {
  const fixes = drive(60, () => 15);
  const t = buildTrack(fixes);
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0].level, 0);
  assert.equal(t.runs[0].points.length, fixes.length);
  assert.deepEqual(t.start, [fixes[0].lat, fixes[0].lon]);
  assert.deepEqual(t.end, [fixes.at(-1).lat, fixes.at(-1).lon]);
  assert.equal(t.bounds[0][0], fixes[0].lat);
  assert.equal(t.bounds[1][0], fixes.at(-1).lat);
  assert.deepEqual(t.events, []);
});

test("a hard stop shows harsh runs and the same events as the score", () => {
  const fixes = drive(90, (s) => (s < 50 ? 20 : Math.max(0, 20 - 6 * (s - 50))));
  const t = buildTrack(fixes);
  assert.ok(
    t.runs.some((r) => r.level === 2),
    "harsh stretch drawn",
  );
  const summary = analyzeFixes(fixes);
  assert.equal(t.events.length, summary.harsh);
  assert.equal(t.events[0].kind, "brake");
  // Runs join up: each run starts where the previous ended.
  for (let i = 1; i < t.runs.length; i++) {
    assert.deepEqual(t.runs[i].points[0], t.runs[i - 1].points.at(-1));
  }
});

test("a signal gap breaks the line instead of drawing a jump", () => {
  const a = drive(30, () => 15);
  const b = drive(30, () => 15, a.at(-1).t + 60_000).map((f) => ({ ...f, lat: f.lat + 0.02 }));
  const t = buildTrack([...a, ...b]);
  const jump = t.runs.some((r) =>
    r.points.some((p, i) => i > 0 && Math.abs(p[0] - r.points[i - 1][0]) > 0.01),
  );
  assert.equal(jump, false);
  assert.ok(t.runs.length >= 2);
});

test("nothing to draw gives null", () => {
  assert.equal(buildTrack([]), null);
});
