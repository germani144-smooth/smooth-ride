// Draws the trip-computer display: readouts with ghost digits, the arched bar graph and the
// flat bar. Built from DOM nodes and text only (never HTML strings). Logic in js/core/lcd.js.
import { ghostFor, displayParts, litSegments, archGeometry, ARCH } from "./core/lcd.js";

const SVG = "http://www.w3.org/2000/svg";

/** Fill `el` with `text`, drawing decimal points as a square dot. textContent stays `text`. */
function fill(el, text) {
  el.replaceChildren(
    ...displayParts(text).map((part) => {
      if (!part.point) return document.createTextNode(part.ch);
      const dot = document.createElement("span");
      dot.className = "dp";
      dot.textContent = ".";
      return dot;
    }),
  );
}

/**
 * Show `text` in a readout. `digits` is the element holding the lit digits; its sibling
 * .ghost gets the unlit 8s behind them.
 */
export function setReadout(digits, text, minDigits = 2) {
  const value = String(text);
  fill(digits, value);
  const ghost = digits.parentElement?.querySelector(".ghost");
  if (ghost) fill(ghost, ghostFor(value, minDigits));
}

/** A new readout element: { root, digits }. */
export function createReadout(text, { minDigits = 2, hot = false, className = "" } = {}) {
  const root = document.createElement("div");
  root.className = `readout ${className}`.trim();
  const ghost = document.createElement("span");
  ghost.className = "ghost";
  ghost.setAttribute("aria-hidden", "true");
  const digits = document.createElement("span");
  digits.className = hot ? "digits hot" : "digits";
  root.append(ghost, digits);
  setReadout(digits, text, minDigits);
  return { root, digits };
}

/** Draw the arch's segments and scale once into `svg`. */
export function buildArch(svg) {
  const g = archGeometry();
  svg.setAttribute("viewBox", `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  for (const points of g.segments) {
    const poly = document.createElementNS(SVG, "polygon");
    poly.setAttribute("points", points);
    svg.appendChild(poly);
  }
  for (const label of g.labels) {
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("x", label.x);
    t.setAttribute("y", label.y + 4);
    t.setAttribute("text-anchor", "middle");
    t.textContent = String(label.value);
    svg.appendChild(t);
  }
}

/** Draw the flat bar's segments once into `bar`. */
export function buildBar(bar, segments = 12) {
  bar.replaceChildren(...Array.from({ length: segments }, () => document.createElement("i")));
}

/** Light the arch and the flat bar up to `score` (0..100, or null for none). */
export function setBars(score, ...containers) {
  for (const box of containers) {
    if (!box) continue;
    const cells = box.querySelectorAll(box.tagName.toLowerCase() === "svg" ? "polygon" : "i");
    const on = litSegments(score, cells.length || ARCH.segments);
    cells.forEach((cell, i) => cell.classList.toggle("lit", i < on));
  }
}
