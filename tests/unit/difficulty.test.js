import { test } from "node:test";
import assert from "node:assert/strict";
import { courseDifficulty, part, DIFFICULTY } from "../../js/core/difficulty.js";
import { finalizeDrive, makeDrive } from "../../js/core/drives.js";
import { demoFixes } from "../../js/core/demo.js";

const M_PER_DEG = 111195;
const T0 = 1_700_000_000_000;

/**
 * A synthetic road in open sea (not a real place), driven at `speed` m/s with a fix every
 * second. `headingAt(metres)` in degrees (0 = north), `altitudeAt(metres)` in m or null.
 * Shape is given per metre of road, so the same road can be driven at any speed.
 */
function road(lengthMetres, { headingAt = () => 0, altitudeAt = () => null, speed = 20 } = {}) {
  const fixes = [];
  let lat = 0.5;
  let lon = 0.5;
  let along = 0;
  for (let i = 0; along <= lengthMetres; i++) {
    if (i > 0) {
      // Walk the second's distance in 1 m steps so the path follows the road's shape.
      for (let m = 0; m < speed; m++) {
        const heading = (headingAt(along) * Math.PI) / 180;
        lat += Math.cos(heading) / M_PER_DEG;
        lon += Math.sin(heading) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
        along++;
      }
    }
    fixes.push({ t: T0 + i * 1000, lat, lon, speed, accuracy: 5, altitude: altitudeAt(along) });
  }
  return fixes;
}

/** Heading of a road made of arcs: `turnDegrees` over `arcMetres`, then straight, alternating. */
function bendyHeading({ arcMetres, turnDegrees, straightMetres }) {
  const period = 2 * (arcMetres + straightMetres);
  return (metres) => {
    const into = metres % period;
    const half = arcMetres + straightMetres;
    const first = Math.min(into, arcMetres) / arcMetres;
    const second = into > half ? Math.min(into - half, arcMetres) / arcMetres : 0;
    // Right, then back left: the heading returns to where it started every period.
    return turnDegrees * (first - second);
  };
}

test("each part ignores its floor and levels off at its maximum", () => {
  const options = { max: 4.5, floor: 30, scale: 80 };
  assert.equal(part(20, options), 0);
  assert.equal(part(30, options), 0);
  assert.ok(Math.abs(part(110, options) - 4.5 * (1 - Math.exp(-1))) < 1e-9);
  assert.ok(part(100000, options) <= 4.5);
  assert.ok(part(100000, options) > 4.49);
  const max = DIFFICULTY.turning.max + DIFFICULTY.bends.max + DIFFICULTY.hills.max;
  assert.equal(max, 10);
});

test("a straight, flat road is 0.0", () => {
  const result = courseDifficulty(road(4000));
  assert.equal(result.difficulty, 0);
  assert.equal(result.turning, 0);
  assert.equal(result.bends, 0);
  assert.equal(result.hills, null); // no altitude recorded
  assert.equal(result.hillsPerKm, null);
});

test("short drives get no difficulty", () => {
  assert.equal(courseDifficulty(road(600)), null);
});

test("speed never changes difficulty: the same road at 36 and 108 km/h", () => {
  const shape = {
    headingAt: bendyHeading({ arcMetres: 120, turnDegrees: 70, straightMetres: 200 }),
    altitudeAt: (metres) => 40 * Math.sin(metres / 600),
  };
  const slow = courseDifficulty(road(6000, { ...shape, speed: 10 }));
  const fast = courseDifficulty(road(6000, { ...shape, speed: 30 }));
  assert.ok(slow.difficulty > 3, `slow ${slow.difficulty}`);
  assert.ok(
    Math.abs(slow.difficulty - fast.difficulty) <= 0.3,
    `slow ${slow.difficulty} vs fast ${fast.difficulty}`,
  );
  assert.equal(slow.bendsPerKm, fast.bendsPerKm);
});

test("more and tighter bends make it harder", () => {
  const gentle = courseDifficulty(
    road(5000, {
      headingAt: bendyHeading({ arcMetres: 300, turnDegrees: 30, straightMetres: 700 }),
    }),
  );
  const twisty = courseDifficulty(
    road(5000, {
      headingAt: bendyHeading({ arcMetres: 60, turnDegrees: 120, straightMetres: 60 }),
      speed: 8,
    }),
  );
  assert.ok(gentle.difficulty < 1.5, `gentle ${gentle.difficulty}`);
  assert.ok(twisty.difficulty > 6, `twisty ${twisty.difficulty}`);
  assert.ok(twisty.bendsPerKm > gentle.bendsPerKm * 3);
  assert.ok(twisty.turning <= DIFFICULTY.turning.max);
});

test("an S-bend is two bends", () => {
  // One 45° right then 45° left, otherwise straight, in 2 km.
  const result = courseDifficulty(
    road(2000, {
      headingAt: (metres) =>
        metres < 900
          ? 0
          : metres < 1000
            ? 0.45 * (metres - 900)
            : metres < 1100
              ? 45 - 0.45 * (metres - 1000)
              : 0,
    }),
  );
  assert.equal(result.bendsPerKm, 1);
});

test("a long motorway curve is no bend; GPS wobble makes no bends", () => {
  // 2 km radius for 600 m (17°): under the noise floor per 100 m.
  const curve = courseDifficulty(
    road(4000, {
      headingAt: (metres) =>
        metres > 1000 && metres < 1600
          ? (metres - 1000) * (180 / Math.PI / 2000)
          : metres >= 1600
            ? 17.2
            : 0,
      speed: 33,
    }),
  );
  assert.equal(curve.difficulty, 0);
  // ±3 m of drifting position noise on a straight road.
  let drift = 0;
  const wobbly = road(4000, { speed: 33 }).map((fix, i) => {
    drift = 0.9 * drift + 0.6 * Math.sin(i * 2.3);
    return { ...fix, lon: fix.lon + drift / M_PER_DEG };
  });
  assert.equal(courseDifficulty(wobbly).bendsPerKm, 0);
});

test("hills count up and down; altitude noise doesn't", () => {
  // ±3 m of altitude jitter on a level road: under the dead band.
  const noisy = courseDifficulty(
    road(4000, { altitudeAt: (metres) => 50 + 3 * Math.sin(metres * 0.09) }),
  );
  assert.equal(noisy.hills, 0);
  // Up 100 m over 2 km, then down 100 m: 200 m of up and down over 4 km = 50 m/km.
  const hill = courseDifficulty(
    road(4000, { altitudeAt: (metres) => (metres <= 2000 ? metres / 20 : 200 - metres / 20) }),
  );
  assert.ok(Math.abs(hill.hillsPerKm - 50) < 5, `hills ${hill.hillsPerKm} m/km`);
  assert.ok(hill.hills > 1.5 && hill.hills <= DIFFICULTY.hills.max, `hills ${hill.hills}`);
  assert.ok(Math.abs(hill.difficulty - (hill.turning + hill.bends + hill.hills)) <= 0.15);
});

test("a gap (tunnel) doesn't turn into a bend", () => {
  const fixes = road(4000);
  // Lose 30 s in the middle and come out 400 m to the east.
  const after = fixes
    .slice(120)
    .map((f) => ({ ...f, t: f.t + 30_000, lon: f.lon + 400 / M_PER_DEG }));
  const result = courseDifficulty([...fixes.slice(0, 100), ...after]);
  assert.equal(result.difficulty, 0);
});

test("finalized drives carry the difficulty; the demo drive has some", () => {
  const done = finalizeDrive(makeDrive({ source: "demo", fixes: demoFixes(T0) }));
  assert.ok(done.summary.course, "demo drive has a course difficulty");
  assert.ok(done.summary.course.difficulty > 0 && done.summary.course.difficulty <= 10);
});
