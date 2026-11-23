// Map tile sources and when to give up on the dark map. Pure, unit tested.
//
// Dark: Stadia Maps "Alidade Smooth Dark", authenticated by the app's address (registered
// in the Stadia account; no API key anywhere). Fallback: plain OpenStreetMap, used when
// Stadia refuses the tiles (domain not registered, quota, outage).

const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const TILE_SOURCES = {
  dark: {
    id: "dark",
    // {r} becomes "@2x" on high-density screens: sharp tiles on phones.
    url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    attribution: [
      `&copy; ${LINK("https://stadiamaps.com/", "Stadia Maps")}`,
      `&copy; ${LINK("https://openmaptiles.org/", "OpenMapTiles")}`,
      `&copy; ${LINK("https://www.openstreetmap.org/copyright", "OpenStreetMap")}`,
    ].join(" "),
  },
  osm: {
    id: "osm",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: `&copy; ${LINK("https://www.openstreetmap.org/copyright", "OpenStreetMap")}`,
  },
};

/** Tile hosts the page loads images from (must match the CSP img-src in index.html). */
export const TILE_HOSTS = Object.values(TILE_SOURCES).map(
  (s) => new URL(s.url.split("{")[0]).origin,
);

/**
 * Decides when to switch from the dark tiles to the fallback: after `maxErrors` failed tiles
 * before any tile has loaded. Once a tile has loaded, the dark map works, and an odd failed
 * tile (a flaky connection) is not a reason to switch.
 */
export function createTileFallback({ maxErrors = 3 } = {}) {
  let loaded = 0;
  let errors = 0;
  let switched = false;
  return {
    loaded() {
      loaded++;
    },
    /** Returns true exactly once: when the map should switch to the fallback. */
    failed() {
      errors++;
      if (!switched && loaded === 0 && errors >= maxErrors) {
        switched = true;
        return true;
      }
      return false;
    },
  };
}
