import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacentTab, classify, offsetFor, isArmed, SWIPE } from "../../js/core/swipe.js";

const TABS = ["drive", "drives", "settings"];

test("adjacentTab follows the bottom bar order", () => {
  assert.equal(adjacentTab(TABS, "drive", -50), "drives"); // swipe left → next
  assert.equal(adjacentTab(TABS, "drives", -50), "settings");
  assert.equal(adjacentTab(TABS, "drives", 50), "drive"); // swipe right → previous
  assert.equal(adjacentTab(TABS, "settings", 50), "drives");
});

test("adjacentTab stops at the first and last tab", () => {
  assert.equal(adjacentTab(TABS, "drive", 50), null);
  assert.equal(adjacentTab(TABS, "settings", -50), null);
  assert.equal(adjacentTab(TABS, "nope", -50), null);
  assert.equal(adjacentTab(TABS, "drives", 0), null);
});

test("classify: starts after 10px sideways and 1.2× more sideways than vertical", () => {
  assert.equal(classify(9, 0), "pending");
  assert.equal(classify(10, 0), "horizontal");
  assert.equal(classify(-10, 0), "horizontal");
  assert.equal(classify(11, 10), "pending"); // not 1.2× more sideways
  assert.equal(classify(12, 10), "horizontal");
});

test("classify: 12px vertical cancels before a swipe starts", () => {
  assert.equal(classify(2, 12), "cancel");
  assert.equal(classify(9, -12), "cancel");
  assert.equal(classify(2, 11), "pending");
});

test("classify: once locked sideways, vertical drift doesn't cancel", () => {
  assert.equal(classify(200, -40, "horizontal"), "horizontal");
  assert.equal(classify(20, 60, "horizontal"), "horizontal");
});

test("offsetFor: half the finger, small resistance at the edges", () => {
  assert.equal(offsetFor(100, true), 100 * SWIPE.follow);
  assert.ok(Math.abs(offsetFor(100, false)) <= SWIPE.edgeMax);
  assert.ok(Math.abs(offsetFor(-1000, false)) <= SWIPE.edgeMax);
  assert.ok(offsetFor(-100, false) < 0);
});

test("isArmed past 70px, never without a target", () => {
  assert.equal(isArmed(69, true), false);
  assert.equal(isArmed(-70, true), true);
  assert.equal(isArmed(300, false), false);
});
