// Pure swipe-between-tabs logic (no DOM), unit tested. Matches Lift Log's swipe.
// The gesture wiring is in js/swipe.js; every number lives here.
export const SWIPE = {
  startPx: 10, // sideways distance before a swipe starts
  ratio: 1.2, // ...and it must be this much more sideways than vertical
  cancelVerticalPx: 12, // cancel when more than this vertically AND more vertical than sideways
  armPx: 70, // at this distance (k = 1) letting go switches tab
  follow: 0.55, // the page follows the finger by this fraction
  edgeFollow: 0.15, // at the first/last tab: resistance
  edgeMax: 24, // px, max movement at the first/last tab
  fadeMax: 0.35, // page opacity drops by up to this while dragging toward a real tab
  labelGain: 1.4, // edge label opacity = min(1, k × labelGain)
  slideInPx: 40, // the new tab slides in from this far
  slideInOpacity: 0.3, // ...starting at this opacity
  slideInMs: 200,
  springMs: 180,
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

/**
 * Gesture state after a move: "pending" (undecided), "horizontal" (swiping) or "cancel".
 * Once a swipe has started it stays a swipe.
 */
export function classify(dx, dy, state = "pending", s = SWIPE) {
  if (state === "horizontal") return "horizontal";
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > s.cancelVerticalPx && ay > ax) return "cancel";
  if (ax >= s.startPx && ax >= s.ratio * ay) return "horizontal";
  return "pending";
}

/** Drag progress k in 0..1; 1 means letting go switches tab. */
export function progress(dx, s = SWIPE) {
  return Math.min(1, Math.abs(dx) / s.armPx);
}

/** How far the page moves for a finger movement dx. */
export function offsetFor(dx, hasTarget, s = SWIPE) {
  if (hasTarget) return dx * s.follow;
  const r = dx * s.edgeFollow;
  return Math.max(-s.edgeMax, Math.min(s.edgeMax, r));
}

/** Page opacity while dragging: fades toward a real tab, no fade at the first/last tab. */
export function pageOpacity(dx, hasTarget, s = SWIPE) {
  return hasTarget ? 1 - s.fadeMax * progress(dx, s) : 1;
}

/** Edge label opacity: follows the drag instead of popping in. */
export function labelOpacity(dx, hasTarget, s = SWIPE) {
  return hasTarget ? Math.min(1, progress(dx, s) * s.labelGain) : 0;
}

/** Whether letting go now would switch tab (label and tab button light up). */
export function isArmed(dx, hasTarget, s = SWIPE) {
  return hasTarget && progress(dx, s) >= 1;
}
