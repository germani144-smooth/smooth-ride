import { test } from "node:test";
import assert from "node:assert/strict";
import { courseDifficulty, part, DIFFICULTY } from "../../js/core/difficulty.js";
import { finalizeDrive, makeDrive } from "../../js/core/drives.js";
import { demoFixes } from "../../js/core/demo.js";

const M_PER_DEG = 111195;
const T0 = 1_700_000_000_000;

/**
 * Synthetic drive at 1 Hz in open sea (not a real place). `headingAt(i)` in degrees
 * (0 = north), `speedAt(i)` in m/s, `altitudeAt(i)` in m or null.
 */
function drive(seconds, { headingAt = () => 0, speedAt = () => 20, altitudeAt = () => null }) {
  const fixes = [];
  let lat = 0.5;
  let lon = 0.5;
  for (let i = 0; i <= seconds; i++) {
    if (i > 0) {
      const heading = (headingAt(i) * Math.PI) / 180;
      const step = speedAt(i);
      lat += (step * Math.cos(heading)) / M_PER_DEG;
      lon += (step * Math.sin(heading)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
    }
    fixes.push({
      t: T0 + i * 1000,
      lat,
      lon,
      speed: speedAt(i),
      accuracy: 5,
      altitude: altitudeAt(i),
    });
  }
  return fixes;
}

test("each part ignores its floor and levels off at its maximum", () => {
  const options = { max: 5, floor: 60, scale: 200 };
  assert.equal(part(40, options), 0);
  assert.equal(part(60, options), 0);
  assert.ok(Math.abs(part(260, options) - 5 * (1 - Math.exp(-1))) < 1e-9);
  assert.ok(part(100000, options) <= 5);
  assert.ok(part(100000, options) > 4.99);
});

test("a straight, steady, flat road is 0.0", () => {
  const result = courseDifficulty(drive(200, {}));
  assert.equal(result.difficulty, 0);
  assert.equal(result.bends, 0);
  assert.equal(result.speed, 0);
  assert.equal(result.climb, null); // no altitude recorded
  assert.equal(result.climbPerKm, null);
});

test("short drives get no difficulty", () => {
  assert.equal(courseDifficulty(drive(30, {})), null); // 600 m
});

test("bends make it harder, sharper bends much harder", () => {
  // Gentle S-bends: heading swings ±20° every 20 s.
  const gentle = courseDifficulty(
    drive(300, { headingAt: (i) => 20 * Math.sin((i * Math.PI) / 20), speedAt: () => 15 }),
  );
  // Hairpins: heading swings ±80° every 10 s at low speed.
  const twisty = courseDifficulty(
    drive(600, { headingAt: (i) => 80 * Math.sin((i * Math.PI) / 10), speedAt: () => 8 }),
  );
  assert.ok(gentle.bends > 0.5, `gentle ${gentle.bends}`);
  assert.ok(twisty.bends > gentle.bends + 2, `twisty ${twisty.bends} vs ${gentle.bends}`);
  assert.ok(twisty.bends <= DIFFICULTY.bends.max);
});

test("speed changes the road forces add up to 3", () => {
  // 50 km/h zones alternating with 90 km/h every minute.
  const changing = courseDifficulty(
    drive(600, { speedAt: (i) => (Math.floor(i / 60) % 2 ? 25 : 14) }),
  );
  assert.ok(changing.speed >= 0.8, `speed ${changing.speed}`);
  assert.ok(changing.speed <= 3);
  assert.equal(changing.bends, 0);
});

test("climbing counts, GPS altitude noise doesn't", () => {
  // ±3 m of altitude jitter on a flat road: under the dead band.
  const noisy = courseDifficulty(drive(300, { altitudeAt: (i) => 50 + 3 * Math.sin(i * 1.7) }));
  assert.equal(noisy.climb, 0);
  assert.equal(noisy.climbPerKm, 0);
  // Up 1 m every 20 m for 3 km, then down: 150 m climbed over 6 km = 25 m/km.
  const hill = courseDifficulty(
    drive(300, { altitudeAt: (i) => (i <= 150 ? i : 300 - i), speedAt: () => 20 }),
  );
  assert.ok(Math.abs(hill.climbPerKm - 25) < 2, `climb ${hill.climbPerKm} m/km`);
  assert.ok(hill.climb > 1 && hill.climb < 2, `climb ${hill.climb}`);
  assert.ok(Math.abs(hill.difficulty - (hill.bends + hill.speed + hill.climb)) <= 0.15);
});

test("a gap (tunnel) doesn't turn into a bend", () => {
  const fixes = drive(200, {});
  // Lose 30 s in the middle and come out 400 m to the east.
  const after = fixes
    .slice(120)
    .map((f) => ({ ...f, t: f.t + 30_000, lon: f.lon + 400 / M_PER_DEG }));
  const result = courseDifficulty([...fixes.slice(0, 100), ...after]);
  assert.equal(result.bends, 0);
});

test("finalized drives carry the difficulty; the demo drive has some", () => {
  const done = finalizeDrive(makeDrive({ source: "demo", fixes: demoFixes(T0) }));
  assert.ok(done.summary.course, "demo drive has a course difficulty");
  assert.ok(done.summary.course.difficulty > 0 && done.summary.course.difficulty <= 10);
});
