// The trip-computer display, pure: ghost digits behind readouts, how many bar segments
// light up, and the geometry of the arched bar graph over the smoothness digits.

/**
 * The unlit "8"s shown behind a readout, like an LCD's unlit segments. Every digit becomes
 * an 8, a decimal point stays a point, and 8s are added in front up to `minDigits` digits.
 * Anything that isn't a digit or point (a "--" placeholder) also shows as 8s.
 */
export function ghostFor(text, minDigits = 2) {
  let ghost = "";
  let digits = 0;
  for (const ch of String(text)) {
    if (ch === "." || ch === ",") ghost += ".";
    else {
      ghost += "8";
      digits++;
    }
  }
  return "8".repeat(Math.max(0, minDigits - digits)) + ghost;
}

/** How many of `segments` light up for a 0..100 score (none for no score). */
export function litSegments(score, segments) {
  if (score == null || !Number.isFinite(score)) return 0;
  const clamped = Math.max(0, Math.min(100, score));
  return Math.round((clamped / 100) * segments);
}

/** The arched bar graph: a wide, shallow arc of segments, growing taller to the right. */
export const ARCH = {
  segments: 32,
  width: 368,
  height: 150,
  centreY: 290, // centre of the big circle the arc is part of (below the drawing)
  outer: 260, // radius of the arc's outer edge
  inner: 226, // radius of the inner edge at the right end (segments are taller there)
  growth: 0.55, // how much shorter each segment is, going left
  span: 84, // degrees of the circle used
  gap: 0.9, // degrees between segments
  top: 14, // the arc's highest point, from the top of the drawing
  labelInset: 18, // scale numbers sit this far inside the inner edge
};

/**
 * Segment outlines (SVG polygon points) and scale label positions for the arch.
 * Returns { width, height, segments: ["x,y x,y x,y x,y", ...], labels: [{ value, x, y }] }.
 */
export function archGeometry(a = ARCH) {
  const cx = a.width / 2;
  const shift = a.centreY - a.outer - a.top; // lifts the arc so its top sits at `top`
  const start = -90 - a.span / 2;
  const step = a.span / a.segments;
  const at = (deg, r) => {
    const t = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(t), a.centreY + r * Math.sin(t) - shift];
  };
  const fmt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const segments = [];
  for (let i = 0; i < a.segments; i++) {
    const from = start + i * step + a.gap / 2;
    const to = start + (i + 1) * step - a.gap / 2;
    const inner = a.inner + (a.segments - i) * a.growth;
    segments.push(
      [at(from, a.outer), at(to, a.outer), at(to, inner), at(from, inner)].map(fmt).join(" "),
    );
  }
  const labels = [];
  for (let value = 0; value <= 100; value += 20) {
    const [x, y] = at(start + (a.span * value) / 100, a.inner - a.labelInset);
    labels.push({ value, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return { width: a.width, height: a.height, segments, labels };
}
