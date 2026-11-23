import { test } from "node:test";
import assert from "node:assert/strict";
import { DARK_MAP, curveAt, darkCurve, tintMatrix, tintGrey } from "../../js/core/mapstyle.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("curve: former white roads become a soft grey, lighter than the land", () => {
  close(curveAt(0), DARK_MAP.roadGrey);
  close(curveAt(DARK_MAP.landLevel), DARK_MAP.landLevel);
  assert.ok(curveAt(0) > curveAt(DARK_MAP.landLevel) * 3);
});

test("curve: mid-tones (water, buildings) stay just above the land, below roads", () => {
  for (const x of [0.15, 0.2, 0.3, 0.45]) {
    const y = curveAt(x);
    assert.ok(y > DARK_MAP.landLevel && y < DARK_MAP.roadGrey, `${x} → ${y}`);
  }
});

test("curve: labels (dark text, light after inverting) stay light", () => {
  assert.ok(curveAt(0.85) > 0.7);
  close(curveAt(1), 1);
});

test("curve is continuous and has curveSteps + 1 table values in 0..1", () => {
  const values = darkCurve();
  assert.equal(values.length, DARK_MAP.curveSteps + 1);
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) < 0.06);
});

test("tint: land lands on the app background (#0f1c1f), labels stay light", () => {
  const [r, g, b] = tintGrey(DARK_MAP.landLevel).map((c) => Math.round(c * 255));
  const bg = [0x0f, 0x1c, 0x1f];
  [r, g, b].forEach((c, i) => assert.ok(Math.abs(c - bg[i]) <= 4, `${[r, g, b]} vs ${bg}`));
  assert.ok(tintGrey(0.9).every((c) => c > 0.75));
});

test("tint matrix matches tintGrey for a grey input", () => {
  const m = tintMatrix();
  assert.equal(m.length, 20);
  const grey = 0.3;
  const out = [0, 1, 2].map((row) => m[row * 5] * grey + m[row * 5 + 4]);
  out.forEach((c, i) => close(c, tintGrey(grey)[i]));
});
