import { test } from "node:test";
import assert from "node:assert/strict";
import { profileScore } from "../../js/core/profile.js";

const drive = (score, km, source = "live") => ({
  source,
  inProgress: false,
  summary: { score, distance: km * 1000 },
});

test("weights each drive's score by its distance", () => {
  // 40 km at 80 and 4 km at 30: (80·40 + 30·4) / 44 = 75.45 → 75
  const p = profileScore([drive(80, 40), drive(30, 4)]);
  assert.equal(p.score, 75);
  assert.equal(p.distance, 44000);
  assert.equal(p.drives, 2);
});

test("equal distances give the plain average", () => {
  assert.equal(profileScore([drive(60, 10), drive(80, 10)]).score, 70);
});

test("leaves out demo, in-progress and unscored drives", () => {
  const p = profileScore([
    drive(90, 10),
    drive(10, 100, "demo"),
    { source: "live", inProgress: true, summary: null },
    drive(null, 0.1),
  ]);
  assert.equal(p.score, 90);
  assert.equal(p.drives, 1);
  assert.equal(p.unscored, 1);
});

test("GPX drives count like live drives", () => {
  assert.equal(profileScore([drive(50, 10, "gpx"), drive(70, 10)]).score, 60);
});

test("no real drives yet: no score", () => {
  assert.deepEqual(profileScore([drive(55, 3, "demo")]), {
    score: null,
    distance: 0,
    drives: 0,
    unscored: 0,
  });
});
