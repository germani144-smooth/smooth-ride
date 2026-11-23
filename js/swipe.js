// Swipe between tabs, behaving like Lift Log's. Passive touch listeners on the whole
// document, no library. All numbers come from js/core/swipe.js.
import {
  SWIPE,
  adjacentTab,
  classify,
  offsetFor,
  pageOpacity,
  labelOpacity,
  isArmed,
} from "./core/swipe.js";

// Places a swipe must never start from.
const NO_SWIPE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-noswipe], .tabs, dialog, [role='dialog']";

export function createSwipe({
  label,
  getTabs,
  getCurrent,
  getView,
  getTabButton,
  labelFor,
  onSwitch,
  isBlocked,
}) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let g = null; // current gesture

  function blockedTarget(target) {
    if (isBlocked()) return true;
    if (document.querySelector("dialog[open]")) return true;
    return target instanceof Element && target.closest(NO_SWIPE) !== null;
  }

  function lightUp(armed, target) {
    label.classList.toggle("armed", armed);
    getTabs().forEach((t) =>
      getTabButton(t).classList.toggle("swipe-armed", armed && t === target),
    );
  }

  function paint(dx) {
    const has = Boolean(g.target);
    const view = getView(getCurrent());
    view.classList.remove("swipe-in");
    view.style.transition = "none";
    view.style.transform = `translateX(${offsetFor(dx, has)}px)`;
    view.style.opacity = String(pageOpacity(dx, has));

    if (has) {
      label.textContent = dx < 0 ? `${labelFor(g.target)} ›` : `‹ ${labelFor(g.target)}`;
      label.classList.toggle("right", dx < 0);
      label.classList.toggle("left", dx > 0);
    }
    label.style.transition = "none";
    label.style.opacity = String(labelOpacity(dx, has));
    g.armed = isArmed(dx, has);
    lightUp(g.armed, g.target);
  }

  function hideLabel(animated) {
    label.style.transition = animated ? `opacity ${SWIPE.springMs}ms ease-out` : "none";
    label.style.opacity = "0";
    lightUp(false, null);
  }

  function springBack() {
    const view = getView(getCurrent());
    const animated = !reduced.matches;
    view.style.transition = animated
      ? `transform ${SWIPE.springMs}ms ease-out, opacity ${SWIPE.springMs}ms ease-out`
      : "none";
    view.style.transform = "";
    view.style.opacity = "";
    hideLabel(animated);
  }

  function slideIn(view, dir) {
    view.classList.remove("swipe-in");
    // Swiping left brings the next tab in from the right, and vice versa.
    view.style.setProperty("--swipe-from", `${dir < 0 ? SWIPE.slideInPx : -SWIPE.slideInPx}px`);
    view.style.setProperty("--swipe-from-opacity", String(SWIPE.slideInOpacity));
    view.style.animationDuration = `${SWIPE.slideInMs}ms`;
    void view.offsetWidth; // restart the animation if it was still running
    view.classList.add("swipe-in");
    view.addEventListener("animationend", () => view.classList.remove("swipe-in"), {
      once: true,
    });
  }

  function finish() {
    if (!g) return;
    const { state, armed, target, dir } = g;
    g = null;
    if (state !== "horizontal") return;
    if (!(armed && target)) {
      springBack();
      return;
    }
    const old = getView(getCurrent());
    old.style.transition = "none";
    old.style.transform = "";
    old.style.opacity = "";
    hideLabel(false);
    onSwitch(target);
    if (!reduced.matches) slideIn(getView(target), dir);
  }

  function abort() {
    if (g && g.state === "horizontal") springBack();
    g = null;
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1 || blockedTarget(e.target)) {
        abort();
        return;
      }
      const t = e.touches[0];
      g = { x: t.clientX, y: t.clientY, state: "pending", target: null, armed: false, dir: 0 };
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!g) return;
      if (e.touches.length !== 1) {
        abort();
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      const next = classify(dx, dy, g.state);
      if (next === "cancel") {
        abort();
        return;
      }
      g.state = next;
      if (next !== "horizontal") return;
      g.dir = dx < 0 ? -1 : 1;
      g.target = adjacentTab(getTabs(), getCurrent(), dx);
      paint(dx);
    },
    { passive: true },
  );

  document.addEventListener("touchend", finish, { passive: true });
  document.addEventListener("touchcancel", abort, { passive: true });

  // A long press opens the context menu, which cancels the touch. Not a touch listener, so
  // touch handling stays passive; text fields keep their menu (copy/paste).
  document.addEventListener("contextmenu", (e) => {
    if (!(e.target instanceof Element && e.target.closest("input, textarea"))) e.preventDefault();
  });
}
