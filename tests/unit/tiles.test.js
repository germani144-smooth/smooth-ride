import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TILE_SOURCES, TILE_HOSTS, createTileFallback } from "../../js/core/tiles.js";

test("dark tiles are Stadia's Alidade Smooth Dark, sharp on phones, no key", () => {
  const { url, attribution } = TILE_SOURCES.dark;
  assert.match(url, /^https:\/\/tiles\.stadiamaps\.com\/tiles\/alidade_smooth_dark\//);
  assert.ok(url.includes("{r}"));
  assert.doesNotMatch(url, /api_key|key=/);
  for (const credit of ["Stadia Maps", "OpenMapTiles", "OpenStreetMap"]) {
    assert.ok(attribution.includes(credit), credit);
  }
});

test("fallback is plain OpenStreetMap with its attribution", () => {
  assert.equal(TILE_SOURCES.osm.url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.ok(TILE_SOURCES.osm.attribution.includes("OpenStreetMap"));
});

test("tile hosts match the CSP img-src exactly", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const hosts = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]).sort();
  assert.deepEqual(hosts, [...TILE_HOSTS].sort());
});

test("switches after 3 refused tiles when none has loaded, exactly once", () => {
  const f = createTileFallback();
  assert.equal(f.failed(), false);
  assert.equal(f.failed(), false);
  assert.equal(f.failed(), true);
  assert.equal(f.failed(), false);
});

test("doesn't switch for odd failures once tiles have loaded", () => {
  const f = createTileFallback();
  f.loaded();
  for (let i = 0; i < 10; i++) assert.equal(f.failed(), false);
});
