// Swipe between tabs. Passive touch listeners only (never blocks scrolling), no library.
import { adjacentTab, classify, offsetFor, isArmed } from "./core/swipe.js";

// Places a swipe must never start from.
const NO_SWIPE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-noswipe], .tabs, dialog, [role='dialog']";

export function createSwipe({
  area,
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

  function paint(dx) {
    const view = getView(getCurrent());
    const offset = offsetFor(dx, Boolean(g.target));
    view.style.transition = "none";
    view.style.transform = `translateX(${offset}px)`;
    view.style.opacity = String(1 - Math.min(0.25, Math.abs(offset) / 400));

    const armed = isArmed(dx, Boolean(g.target));
    if (g.target) {
      label.textContent = dx < 0 ? `${labelFor(g.target)} ›` : `‹ ${labelFor(g.target)}`;
      label.className = `swipe-label show ${dx < 0 ? "right" : "left"}${armed ? " armed" : ""}`;
    } else {
      label.className = "swipe-label";
    }
    getTabs().forEach((t) =>
      getTabButton(t).classList.toggle("swipe-armed", armed && t === g.target),
    );
    g.armed = armed;
  }

  function clear() {
    label.className = "swipe-label";
    getTabs().forEach((t) => getTabButton(t).classList.remove("swipe-armed"));
  }

  function springBack() {
    const view = getView(getCurrent());
    view.style.transition = reduced.matches
      ? "none"
      : "transform 200ms ease-out, opacity 200ms ease-out";
    view.style.transform = "";
    view.style.opacity = "";
    clear();
  }

  function finish() {
    if (!g) return;
    const { state, armed, target, dir } = g;
    g = null;
    if (state === "horizontal" && armed && target) {
      const old = getView(getCurrent());
      old.style.transition = "none";
      old.style.transform = "";
      old.style.opacity = "";
      clear();
      onSwitch(target);
      if (!reduced.matches) {
        const view = getView(target);
        // Slide in from the side the finger came from.
        view.style.transition = "none";
        view.style.transform = `translateX(${dir < 0 ? 40 : -40}%)`;
        view.style.opacity = "0.6";
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            view.style.transition = "transform 220ms ease-out, opacity 220ms ease-out";
            view.style.transform = "";
            view.style.opacity = "";
          }),
        );
      }
    } else if (state === "horizontal") {
      springBack();
    }
  }

  area.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1 || blockedTarget(e.target)) {
        if (g && g.state === "horizontal") springBack();
        g = null;
        return;
      }
      const t = e.touches[0];
      g = { x: t.clientX, y: t.clientY, state: "pending", target: null, armed: false, dir: 0 };
    },
    { passive: true },
  );

  area.addEventListener(
    "touchmove",
    (e) => {
      if (!g) return;
      if (e.touches.length !== 1) {
        if (g.state === "horizontal") springBack();
        g = null;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      const next = classify(dx, dy, g.state);
      if (next === "cancel") {
        if (g.state === "horizontal") springBack();
        g = null;
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

  area.addEventListener("touchend", finish, { passive: true });
  area.addEventListener(
    "touchcancel",
    () => {
      if (g && g.state === "horizontal") springBack();
      g = null;
    },
    { passive: true },
  );
}
