// Drive map with the pinned local Leaflet (loaded only when a map is first opened).
// Tiles: Stadia Maps' dark style, falling back to plain OpenStreetMap (js/core/tiles.js).
import { buildTrack } from "./core/track.js";
import { unpackFix } from "./core/drives.js";
import { TILE_SOURCES, createTileFallback } from "./core/tiles.js";

const LEAFLET = "vendor/leaflet-1.9.4/";
const COLORS = { 0: "#5fe0b4", 1: "#ffb547", 2: "#ff6b6b" };
const EVENT_STYLE = {
  brake: { color: "#ff6b6b", label: "Harsh braking" },
  accel: { color: "#ffb547", label: "Harsh acceleration" },
  lateral: { color: "#b18cff", label: "Sharp corner" },
};

let leafletPromise = null;
// Once the dark tiles have been refused, later maps in this session go straight to OSM.
let darkRefused = false;

/** A tile layer for `source`. Both providers need a referrer; send only our origin. */
function tileLayer(L, source) {
  return L.tileLayer(source.url, {
    maxZoom: source.maxZoom,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: source.attribution,
    className: `tiles-${source.id}`,
  });
}

/** Dark tiles, switching the map to OpenStreetMap if Stadia refuses them. */
function addTiles(L, map, container) {
  if (darkRefused) {
    tileLayer(L, TILE_SOURCES.osm).addTo(map);
    container.dataset.tiles = "osm";
    return;
  }
  const dark = tileLayer(L, TILE_SOURCES.dark);
  const fallback = createTileFallback();
  dark.on("tileload", () => fallback.loaded());
  dark.on("tileerror", () => {
    if (!fallback.failed()) return;
    darkRefused = true;
    map.removeLayer(dark);
    tileLayer(L, TILE_SOURCES.osm).addTo(map);
    container.dataset.tiles = "osm";
  });
  dark.addTo(map);
  container.dataset.tiles = "dark";
}

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
  addTiles(L, map, container);

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
