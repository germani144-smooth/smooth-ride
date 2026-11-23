import { test } from "node:test";
import assert from "node:assert/strict";
import { demoFixes, DEMO_NAME } from "../../js/core/demo.js";
import { analyzeFixes } from "../../js/core/analysis.js";
import { makeDrive, isValidDrive } from "../../js/core/drives.js";

const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);

test("demo drive shows one of each harsh event and an amber score", () => {
  const s = analyzeFixes(demoFixes(T0));
  assert.deepEqual(s.events, { brake: 1, accel: 1, lateral: 1 });
  assert.ok(s.score >= 40 && s.score < 75, `score ${s.score}`);
  assert.ok(s.distance > 2500 && s.distance < 5000, `distance ${s.distance}`);
  assert.equal(s.stops, 2);
});

test("demo drive is deterministic, 1 Hz, and starts at the given time", () => {
  const a = demoFixes(T0);
  const b = demoFixes(T0);
  assert.deepEqual(a, b);
  assert.equal(a[0].t, T0);
  assert.ok(a.every((f, i) => i === 0 || f.t - a[i - 1].t === 1000));
});

test("demo drive is a valid stored drive", () => {
  const d = makeDrive({ source: "demo", name: DEMO_NAME, fixes: demoFixes(T0) });
  assert.ok(isValidDrive(d));
  assert.equal(d.inProgress, false);
});
