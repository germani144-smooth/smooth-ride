// Drive map with the pinned local Leaflet (loaded only when a map is first opened).
// Tiles: Stadia Maps' dark style, falling back to plain OpenStreetMap (js/core/tiles.js).
import { buildTrack } from "./core/track.js";
import { unpackFix } from "./core/drives.js";
import { TILE_SOURCES, createTileFallback } from "./core/tiles.js";
import { t } from "./core/i18n.js";

const LEAFLET = "vendor/leaflet-1.9.4/";
// Same palette as css/base.css: smooth is quiet cream so only firm and harsh stand out.
const CABIN = "#120e0a";
const CREAM = "#cdbfa8";
const AMBER = "#ffb648";
const RED = "#ff6a4d";
const COLORS = { 0: CREAM, 1: AMBER, 2: RED };
const EVENT_STYLE = {
  // Every harsh event is a red dot (where you lost points); the popup says which kind.
  brake: { color: RED, label: "event.brake" },
  accel: { color: RED, label: "event.accel" },
  lateral: { color: RED, label: "event.lateral" },
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
        reject(new Error(t("map.failed")));
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
        color: CABIN,
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
      color: CABIN,
      weight: 2,
      fillColor: style.color,
      fillOpacity: 1,
      className: `event event-${ev.kind}`,
    })
      .bindPopup(popupText(t(style.label)))
      .addTo(map);
  }

  const pin = (latlng, fill, cls, text) =>
    L.circleMarker(latlng, {
      radius: 8,
      color: CREAM,
      weight: 3,
      fillColor: fill,
      fillOpacity: 1,
      className: cls,
    })
      .bindPopup(popupText(text))
      .addTo(map);
  pin(track.start, AMBER, "pin-start", t("map.start"));
  pin(track.end, CABIN, "pin-end", t("map.finish"));

  map.fitBounds(track.bounds, { padding: [24, 24], maxZoom: 17 });
  return map;
}
