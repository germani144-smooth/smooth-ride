// Drive map with the pinned local Leaflet (loaded only when a map is first opened).
// Tiles come from OpenStreetMap, the only outside address the CSP allows.
import { buildTrack } from "./core/track.js";
import { unpackFix } from "./core/drives.js";

const LEAFLET = "vendor/leaflet-1.9.4/";
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const COLORS = { 0: "#5fe0b4", 1: "#ffb547", 2: "#ff6b6b" };
const EVENT_STYLE = {
  brake: { color: "#ff6b6b", label: "Harsh braking" },
  accel: { color: "#ffb547", label: "Harsh acceleration" },
  lateral: { color: "#b18cff", label: "Sharp corner" },
};

let leafletPromise = null;

/** Load Leaflet's CSS and script once, from our own address. */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET + "leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = LEAFLET + "leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => {
        leafletPromise = null;
        reject(new Error("Map could not load."));
      };
      document.head.appendChild(js);
    });
  }
  return leafletPromise;
}

function popupText(text) {
  const el = document.createElement("span");
  el.textContent = text; // DOM node, never an HTML string
  return el;
}

/** Draw a drive into `container`. Returns the Leaflet map (call .remove() to dispose). */
export async function showDriveMap(container, drive) {
  const L = await loadLeaflet();
  const track = buildTrack(drive.fixes.map(unpackFix));
  if (!track) return null;

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
  });
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILES, {
    maxZoom: 19,
    // OpenStreetMap requires a referrer; send only our origin, never the page path.
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // Dark outline under the coloured route so it reads on any tile.
  const all = track.runs.flatMap((r) => r.points);
  if (all.length > 1) {
    for (const run of track.runs) {
      L.polyline(run.points, {
        color: "#0f1c1f",
        weight: 8,
        opacity: 0.6,
        interactive: false,
      }).addTo(map);
    }
  }
  for (const run of track.runs) {
    L.polyline(run.points, {
      color: COLORS[run.level],
      weight: 5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      className: `route route-${run.level}`,
    }).addTo(map);
  }

  for (const ev of track.events) {
    const style = EVENT_STYLE[ev.kind];
    L.circleMarker([ev.lat, ev.lon], {
      radius: 7,
      color: "#0f1c1f",
      weight: 2,
      fillColor: style.color,
      fillOpacity: 1,
      className: `event event-${ev.kind}`,
    })
      .bindPopup(popupText(style.label))
      .addTo(map);
  }

  const pin = (latlng, fill, cls, text) =>
    L.circleMarker(latlng, {
      radius: 8,
      color: "#eef6f3",
      weight: 3,
      fillColor: fill,
      fillOpacity: 1,
      className: cls,
    })
      .bindPopup(popupText(text))
      .addTo(map);
  pin(track.start, "#5fe0b4", "pin-start", "Start");
  pin(track.end, "#0f1c1f", "pin-end", "Finish");

  map.fitBounds(track.bounds, { padding: [24, 24], maxZoom: 17 });
  return map;
}
