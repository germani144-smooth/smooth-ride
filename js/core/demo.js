// A simulated demo drive (not anyone's real trip), so the Drives tab and map can be tried
// without driving. Deterministic: the same fixes every time, 1 Hz like a GPS.
// It is drawn around Amager Fælled in Copenhagen, an open nature area, so the made-up route
// doesn't pretend to follow real streets.

export const DEMO_NAME = "Demo drive (simulated)";
const START = { lat: 55.6505, lon: 12.5715 };
const M_PER_DEG = 111195;

// Each leg: duration (s), speed at start and end (m/s, linear), total turn (degrees, + = right).
const LEGS = [
  { dur: 20, v0: 0, v1: 14, turn: 0 }, // gentle pull-away
  { dur: 40, v0: 14, v1: 14, turn: 30 }, // cruise with a soft bend
  { dur: 16, v0: 14, v1: 6, turn: 0 }, // gentle slow-down
  { dur: 10, v0: 6, v1: 6, turn: 90 }, // calm right turn
  { dur: 5, v0: 6, v1: 18, turn: 0 }, // harsh acceleration (2.4 m/s²)
  { dur: 45, v0: 18, v1: 18, turn: -25 }, // fast cruise
  { dur: 4, v0: 18, v1: 0, turn: 0 }, // harsh brake (4.5 m/s²)
  { dur: 10, v0: 0, v1: 0, turn: 0 }, // stopped
  { dur: 18, v0: 0, v1: 12, turn: 0 }, // gentle pull-away
  { dur: 5, v0: 12, v1: 12, turn: 110 }, // sharp corner (about 4.6 m/s² sideways, held)
  { dur: 40, v0: 12, v1: 12, turn: -40 }, // cruise
  { dur: 20, v0: 12, v1: 8, turn: 0 }, // coasting
  { dur: 10, v0: 8, v1: 8, turn: -90 }, // calm left turn
  { dur: 60, v0: 8, v1: 11, turn: 15 }, // easy cruise
  { dur: 22, v0: 11, v1: 0, turn: 0 }, // gentle stop
];

/** The demo drive's fixes, starting at `startTime` (ms). */
export function demoFixes(startTime) {
  const fixes = [];
  const cosLat = Math.cos((START.lat * Math.PI) / 180);
  let x = 0; // m east
  let y = 0; // m north
  let heading = (20 * Math.PI) / 180; // north-north-east
  let t = 0;
  const push = (v) =>
    fixes.push({
      t: startTime + t * 1000,
      lat: START.lat + y / M_PER_DEG,
      lon: START.lon + x / (M_PER_DEG * cosLat),
      speed: Math.round(v * 100) / 100,
      accuracy: 5,
    });

  let v = 0;
  push(v);
  for (const leg of LEGS) {
    const turnRate = (leg.turn * Math.PI) / 180 / leg.dur;
    for (let i = 1; i <= leg.dur; i++) {
      const vNew = leg.v0 + ((leg.v1 - leg.v0) * i) / leg.dur;
      const dist = (v + vNew) / 2; // over one second
      const h = heading + turnRate / 2; // midpoint heading for this second
      x += dist * Math.sin(h);
      y += dist * Math.cos(h);
      heading += turnRate;
      v = vNew;
      t += 1;
      push(v);
    }
  }
  return fixes;
}
