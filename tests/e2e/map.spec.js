import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// A tiny grey tile served instead of OpenStreetMap: tests never hit the real tile server.
const TILE = readFileSync(new URL("../../icons/icon-192.png", import.meta.url));
const M_PER_DEG = 111195;

/** Synthetic GPX (open sea near 0.5,0.5): cruise, hard stop, go again. */
function syntheticGpx() {
  const pts = [];
  let lat = 0.5;
  const v = (i) =>
    i < 60
      ? 18
      : i < 64
        ? Math.max(0, 18 - 6 * (i - 60))
        : i < 70
          ? 0
          : Math.min(18, 1.2 * (i - 70));
  for (let i = 0; i <= 120; i++) {
    if (i > 0) lat += (v(i - 1) + v(i)) / 2 / M_PER_DEG;
    const t = new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString();
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="0.5"><time>${t}</time></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Map test</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

test.beforeEach(async ({ page }) => {
  // Stub both tile servers: tests never hit Stadia or OpenStreetMap.
  for (const host of ["https://tiles.stadiamaps.com/**", "https://tile.openstreetmap.org/**"]) {
    await page.route(host, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
    );
  }
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(e.violatedDirective + " " + e.blockedURI),
    );
  });
  page.on("pageerror", (err) => {
    throw err;
  });
  await page.goto("./");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "map.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(syntheticGpx()),
  });
  await expect(page.getByTestId("drive")).toHaveCount(1);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test("tapping a drive shows its route on the dark map", async ({ page }) => {
  const tiles = [];
  page.on("request", (r) => r.url().startsWith("https://tiles.stadiamaps.com/") && tiles.push(r));
  await page.getByTestId("drive").getByRole("button").first().click();
  const map = page.getByTestId("drive-map");
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(map).toHaveAttribute("data-tiles", "dark");
  // (The synthetic route runs due north, so its box is 0 px wide: count, don't "see".)
  await expect(map.locator("path.route")).not.toHaveCount(0);
  await expect(map.locator("path.route-2")).not.toHaveCount(0); // the hard stop is red
  await expect(map.locator("path.event-brake")).toHaveCount(1);
  await expect(map.locator("path.pin-start")).toHaveCount(1);
  await expect(map.locator("path.pin-end")).toHaveCount(1);
  const credits = map.locator(".leaflet-control-attribution");
  for (const c of ["Stadia Maps", "OpenMapTiles", "OpenStreetMap"])
    await expect(credits).toContainText(c);
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(tiles[0].url()).toContain("/tiles/alidade_smooth_dark/");
  // Stadia checks our address: send only the origin, never the page path. No key.
  expect(await tiles[0].headerValue("referer")).toBe("http://localhost:4173/");
  expect(tiles[0].url()).not.toMatch(/key=/);
});

test("controls and attribution are dark", async ({ page }) => {
  await page.getByTestId("drive").getByRole("button").first().click();
  const map = page.getByTestId("drive-map");
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(map).toHaveCSS("background-color", "rgb(18, 14, 10)");
  await expect(map.locator(".leaflet-control-attribution")).toHaveCSS(
    "background-color",
    "rgba(18, 14, 10, 0.8)",
  );
  await expect(map.locator(".leaflet-control-zoom-in")).toHaveCSS(
    "background-color",
    "rgb(27, 20, 12)",
  );
  // No filter on the tiles any more: Stadia's tiles are dark by design.
  const filter = await map
    .locator(".leaflet-tile-pane")
    .evaluate((el) => getComputedStyle(el).filter);
  expect(filter).toBe("none");
});

test("if Stadia refuses the tiles, the map switches to OpenStreetMap", async ({ page }) => {
  // Registered last, so it wins over the stub: Stadia says "unauthorized".
  await page.route("https://tiles.stadiamaps.com/**", (route) => route.fulfill({ status: 401 }));
  const osm = [];
  page.on("request", (r) => r.url().startsWith("https://tile.openstreetmap.org/") && osm.push(r));
  await page.getByTestId("drive").getByRole("button").first().click();
  const map = page.getByTestId("drive-map");
  await expect(map).toHaveAttribute("data-tiles", "osm");
  await expect.poll(() => osm.length).toBeGreaterThan(0);
  await expect(map.locator(".leaflet-control-attribution")).not.toContainText("Stadia");
  await expect(map.locator("path.route")).not.toHaveCount(0); // the route still draws

  // The next map in this session goes straight to OpenStreetMap.
  await page.getByRole("button", { name: "Demo drive" }).click();
  await expect(page.getByTestId("drive-map")).toHaveAttribute("data-tiles", "osm");
});

test("Leaflet loads from our own address", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
  await page.getByTestId("drive").getByRole("button").first().click();
  await expect(page.getByTestId("drive-map")).toHaveClass(/leaflet-container/);
  expect(scripts.some((u) => u.endsWith("/smooth-ride/vendor/leaflet-1.9.4/leaflet.js"))).toBe(
    true,
  );
  expect(scripts.every((u) => u.startsWith("http://localhost:4173/"))).toBe(true);
});

test("tapping an event marker names it", async ({ page }) => {
  await page.getByTestId("drive").getByRole("button").first().click();
  const marker = page.getByTestId("drive-map").locator("path.event-brake");
  await expect(marker).toHaveCount(1);
  await marker.dispatchEvent("click");
  await expect(page.locator(".leaflet-popup-content")).toHaveText("Harsh braking");
});

test("dragging on the map pans it and never switches tab", async ({ page }) => {
  await page.getByTestId("drive").getByRole("button").first().click();
  const map = page.getByTestId("drive-map");
  await expect(map).toHaveClass(/leaflet-container/);
  const box = await map.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width - 40;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x0 - i * 15, y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".tabs button[aria-current='page']")).toHaveText("History");
  await expect(page.locator("#swipe-label")).toHaveCSS("opacity", "0");
});

test("braking loss is shown in kJ per tonne per km", async ({ page }) => {
  await page.getByTestId("drive").getByRole("button").first().click();
  const stat = page
    .getByTestId("drive-detail")
    .locator(".stat", { hasText: "Braking kJ/t per km" })
    .locator(".stat-value");
  // One stop from 18 m/s over ~1.9 km: ½·18² = 162 kJ/t, so roughly 80-90 per km.
  const value = Number(await stat.textContent());
  expect(value).toBeGreaterThan(60);
  expect(value).toBeLessThan(110);
});

test("closing the drive removes the map", async ({ page }) => {
  const row = page.getByTestId("drive").getByRole("button").first();
  await row.click();
  await expect(page.getByTestId("drive-map")).toHaveClass(/leaflet-container/);
  await row.click();
  await expect(page.getByTestId("drive-map")).toHaveCount(0);
});

test("the demo drive opens straight on the map", async ({ page }) => {
  await page.getByRole("button", { name: "Demo drive" }).click();
  await expect(page.locator("#gpx-status")).toContainText("demo drive");
  const demo = page.getByTestId("drive").filter({ hasText: "Demo drive (simulated)" });
  await expect(demo).toContainText("Demo");
  await expect(demo.getByTestId("drive-difficulty").locator(".digits")).toHaveText(/^\d+\.\d$/);
  await expect(demo.getByTestId("course-stats")).toContainText("Fast corners /3.5");
  const map = demo.getByTestId("drive-map");
  await expect(map).toHaveClass(/leaflet-container/);
  await expect(map.locator("path.event-brake")).toHaveCount(1);
  await expect(map.locator("path.event-accel")).toHaveCount(1);
  await expect(map.locator("path.event-lateral")).toHaveCount(1);
  await expect(map.locator("path.route-0")).not.toHaveCount(0);
});
