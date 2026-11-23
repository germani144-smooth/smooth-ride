// Pure swipe-between-tabs logic (no DOM), unit tested. The gesture wiring is in js/swipe.js.
export const SWIPE = {
  startPx: 10, // horizontal distance before a swipe starts
  ratio: 1.2, // ...and it must be this much more sideways than vertical
  cancelVerticalPx: 12, // vertical movement that cancels (scrolling always wins)
  armPx: 70, // past this, letting go switches tab
  follow: 0.5, // the page follows the finger by this fraction
  edgeFollow: 0.15, // at the first/last tab: resistance
  edgeMax: 24, // px, max movement at the first/last tab
};

/**
 * The tab a horizontal swipe heads to, in bottom-bar order. Swiping left (dx < 0) goes to the
 * next tab, right (dx > 0) to the previous one. Returns null at the first/last tab.
 */
export function adjacentTab(tabs, current, dx) {
  const i = tabs.indexOf(current);
  if (i < 0 || dx === 0) return null;
  const j = dx < 0 ? i + 1 : i - 1;
  return j >= 0 && j < tabs.length ? tabs[j] : null;
}

/** Gesture state after a move: "pending" (undecided), "horizontal" (swiping) or "cancel". */
export function classify(dx, dy, state = "pending", s = SWIPE) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= s.cancelVerticalPx) return "cancel";
  if (state === "horizontal") return "horizontal";
  if (ax >= s.startPx && ax >= s.ratio * ay) return "horizontal";
  return "pending";
}

/** How far the page moves for a finger movement dx. */
export function offsetFor(dx, hasTarget, s = SWIPE) {
  if (hasTarget) return dx * s.follow;
  const r = dx * s.edgeFollow;
  return Math.max(-s.edgeMax, Math.min(s.edgeMax, r));
}

/** Whether letting go now would switch tab. */
export function isArmed(dx, hasTarget, s = SWIPE) {
  return hasTarget && Math.abs(dx) >= s.armPx;
}
