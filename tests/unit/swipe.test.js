import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWIPE,
  adjacentTab,
  classify,
  progress,
  offsetFor,
  pageOpacity,
  labelOpacity,
  isArmed,
} from "../../js/core/swipe.js";

const TABS = ["drive", "drives", "settings"];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

/** Feed a finger path through classify like the touchmove handler does. */
function gesture(points) {
  let state = "pending";
  for (const [dx, dy] of points) {
    state = classify(dx, dy, state);
    if (state === "cancel") return { state, dx, dy };
  }
  const [dx, dy] = points.at(-1);
  return { state, dx, dy };
}
const path = (toX, toY, steps = 12, curve = (k) => k) =>
  Array.from({ length: steps }, (_, i) => {
    const k = (i + 1) / steps;
    return [toX * k, toY * curve(k)];
  });

test("the Lift Log numbers", () => {
  assert.equal(SWIPE.startPx, 10);
  assert.equal(SWIPE.ratio, 1.2);
  assert.equal(SWIPE.cancelVerticalPx, 12);
  assert.equal(SWIPE.armPx, 70);
  assert.equal(SWIPE.follow, 0.55);
  assert.equal(SWIPE.edgeFollow, 0.15);
  assert.equal(SWIPE.edgeMax, 24);
  assert.equal(SWIPE.fadeMax, 0.35);
  assert.equal(SWIPE.labelGain, 1.4);
  assert.equal(SWIPE.slideInPx, 40);
  assert.equal(SWIPE.slideInOpacity, 0.3);
  assert.equal(SWIPE.slideInMs, 200);
  assert.equal(SWIPE.springMs, 180);
});

test("adjacentTab follows the bottom bar order and stops at the ends", () => {
  assert.equal(adjacentTab(TABS, "drive", -50), "drives"); // swipe left → next
  assert.equal(adjacentTab(TABS, "drives", -50), "settings");
  assert.equal(adjacentTab(TABS, "drives", 50), "drive"); // swipe right → previous
  assert.equal(adjacentTab(TABS, "drive", 50), null);
  assert.equal(adjacentTab(TABS, "settings", -50), null);
  assert.equal(adjacentTab(TABS, "nope", -50), null);
  assert.equal(adjacentTab(TABS, "drives", 0), null);
});

test("starts at 10px sideways and 1.2× more sideways than vertical", () => {
  assert.equal(classify(9, 0), "pending");
  assert.equal(classify(10, 0), "horizontal");
  assert.equal(classify(-10, 0), "horizontal");
  assert.equal(classify(11, 10), "pending"); // not 1.2× more sideways
  assert.equal(classify(12, 10), "horizontal");
});

test("cancels only past 12px vertically AND more vertical than sideways", () => {
  assert.equal(classify(2, 12), "pending"); // exactly 12: not more than
  assert.equal(classify(2, 13), "cancel");
  assert.equal(classify(-3, -20), "cancel");
  assert.equal(classify(9, 20), "cancel");
  assert.equal(classify(20, 20), "pending"); // 20px down but not more vertical than sideways
});

test("once started it stays a swipe", () => {
  assert.equal(classify(200, -40, "horizontal"), "horizontal");
  assert.equal(classify(20, 90, "horizontal"), "horizontal");
});

test("a diagonal thumb swipe switches tab", () => {
  const g = gesture(path(-120, 60)); // 120px left, 60px down, straight diagonal
  assert.equal(g.state, "horizontal");
  assert.equal(isArmed(g.dx, adjacentTab(TABS, "drives", g.dx) !== null), true);
  assert.equal(adjacentTab(TABS, "drives", g.dx), "settings");
});

test("a curving thumb swipe (sideways, then arcing down) switches tab", () => {
  const g = gesture(path(-160, 50, 16, (k) => k * k));
  assert.equal(g.state, "horizontal");
  assert.ok(isArmed(g.dx, true));
});

test("a vertical scroll never becomes a swipe", () => {
  assert.equal(gesture(path(-30, -200)).state, "cancel");
  assert.equal(gesture(path(8, 150)).state, "cancel");
});

test("the page follows 0.55× the finger; 0.15× capped at 24px at the ends", () => {
  close(offsetFor(100, true), 55);
  close(offsetFor(-100, true), -55);
  close(offsetFor(100, false), 15);
  assert.equal(offsetFor(1000, false), 24);
  assert.equal(offsetFor(-1000, false), -24);
});

test("progress k reaches 1 at 70px", () => {
  close(progress(35), 0.5);
  assert.equal(progress(-70), 1);
  assert.equal(progress(300), 1);
});

test("page fades to 1 − 0.35·k toward a real tab, not at the ends", () => {
  close(pageOpacity(35, true), 1 - 0.35 * 0.5);
  close(pageOpacity(-140, true), 0.65);
  assert.equal(pageOpacity(140, false), 1);
});

test("label opacity follows the drag: min(1, 1.4·k)", () => {
  close(labelOpacity(35, true), 0.7);
  assert.equal(labelOpacity(70, true), 1);
  close(labelOpacity(-10, true), (10 / 70) * 1.4);
  assert.equal(labelOpacity(100, false), 0);
});

test("lights up and switches only at k = 1", () => {
  assert.equal(isArmed(69, true), false);
  assert.equal(isArmed(-70, true), true);
  assert.equal(isArmed(300, false), false);
});
