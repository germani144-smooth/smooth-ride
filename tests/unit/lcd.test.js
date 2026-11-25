import { test } from "node:test";
import assert from "node:assert/strict";
import { ghostFor, displayParts, litSegments, archGeometry, ARCH } from "../../js/core/lcd.js";

test("ghost digits: every digit an 8, points kept, padded in front", () => {
  assert.equal(ghostFor("82", 2), "88");
  assert.equal(ghostFor("1", 2), "88");
  assert.equal(ghostFor("54", 3), "888");
  assert.equal(ghostFor("100", 2), "888");
  assert.equal(ghostFor("0.4", 2), "8.8");
  assert.equal(ghostFor("4.1", 3), "88.8");
  assert.equal(ghostFor("--", 2), "88");
});

test("display parts: digits and points", () => {
  assert.deepEqual(displayParts("0.4"), [{ ch: "0" }, { point: true }, { ch: "4" }]);
  assert.deepEqual(displayParts("54"), [{ ch: "5" }, { ch: "4" }]);
});

test("lit segments follow the score, none without one", () => {
  assert.equal(litSegments(0, 32), 0);
  assert.equal(litSegments(100, 32), 32);
  assert.equal(litSegments(82, 32), 26);
  assert.equal(litSegments(150, 12), 12);
  assert.equal(litSegments(-5, 12), 0);
  assert.equal(litSegments(null, 12), 0);
});

test("arch: right number of segments, all inside the drawing", () => {
  const g = archGeometry();
  assert.equal(g.segments.length, ARCH.segments);
  for (const seg of g.segments) {
    for (const pt of seg.split(" ")) {
      const [x, y] = pt.split(",").map(Number);
      assert.ok(x >= 0 && x <= g.width, `x ${x}`);
      assert.ok(y >= 0 && y <= g.height, `y ${y}`);
    }
  }
  const topY = Math.min(
    ...g.segments.flatMap((s) => s.split(" ").map((p) => Number(p.split(",")[1]))),
  );
  assert.ok(Math.abs(topY - ARCH.top) < 1, `top ${topY}`);
});

test("arch: scale 0..100 left to right, inside the drawing", () => {
  const { labels, width, height } = archGeometry();
  assert.deepEqual(
    labels.map((l) => l.value),
    [0, 20, 40, 60, 80, 100],
  );
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i].x > labels[i - 1].x);
  for (const l of labels) assert.ok(l.x > 10 && l.x < width - 10 && l.y < height - 8);
});
