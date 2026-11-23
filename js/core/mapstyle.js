// Dark map style: numbers for the SVG filter that js/map.js puts over OpenStreetMap's own
// tiles. Pure, unit tested. Steps, in order:
//  1. invert, then rotate hues 180° back (water stays blue-ish, parks green-ish)
//  2. mostly desaturate
//  3. a brightness curve that lifts the darkest tones (white roads, after inverting) to a
//     soft grey, so roads stay lighter than the land instead of turning black, and squeezes
//     the mid-tones (water, buildings, parks) into subtle shapes just above the land, so
//     only labels are brighter than roads
//  4. tint toward the app's dark teal: land ends near --bg (#0f1c1f), labels light.

export const DARK_MAP = {
  saturate: 0.3,
  roadGrey: 0.22, // what pure black (former white roads) becomes
  landLevel: 0.06, // land after step 1–2 sits about here and stays there
  midInput: 0.5, // inputs from landLevel up to here (water, buildings, parks)...
  midLevel: 0.14, // ...are squeezed to between landLevel and this
  curveSteps: 50, // resolution of the brightness curve
  // Tint: output = gain × grey + offset, per channel (R, G, B).
  gain: [0.9, 1.1, 1.1],
  offset: [0, 0.04, 0.05],
};

const lerp = (x, x0, x1, y0, y1) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

/** Step 3 for one input level 0..1. */
export function curveAt(x, style = DARK_MAP) {
  const { roadGrey, landLevel, midInput, midLevel } = style;
  if (x <= landLevel) return lerp(x, 0, landLevel, roadGrey, landLevel); // roads → grey
  if (x <= midInput) return lerp(x, landLevel, midInput, landLevel, midLevel); // squeezed
  return lerp(x, midInput, 1, midLevel, 1); // labels stay light
}

/** Step 3 as SVG tableValues (inputs evenly spaced 0..1). */
export function darkCurve(style = DARK_MAP) {
  const values = [];
  for (let i = 0; i <= style.curveSteps; i++) {
    values.push(Math.round(curveAt(i / style.curveSteps, style) * 1000) / 1000);
  }
  return values;
}

/** The 4×5 matrix for step 4 (feColorMatrix "matrix" values), from a grey input. */
export function tintMatrix(style = DARK_MAP) {
  const [gr, gg, gb] = style.gain;
  const [or, og, ob] = style.offset;
  // Each output channel reads the input's red channel (the image is grey by then).
  return [gr, 0, 0, 0, or, gg, 0, 0, 0, og, gb, 0, 0, 0, ob, 0, 0, 0, 1, 0];
}

/** What a grey level ends up as, as [r, g, b] in 0..1 (for tests and tuning). */
export function tintGrey(grey, style = DARK_MAP) {
  return style.gain.map((g, i) => Math.min(1, g * grey + style.offset[i]));
}
