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
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
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
  await page.getByRole("button", { name: "Drives", exact: true }).click();
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

test("tapping a drive shows its route on a map", async ({ page }) => {
  const tiles = [];
  page.on("request", (r) => r.url().startsWith("https://tile.openstreetmap.org/") && tiles.push(r));
  await page.getByTestId("drive").getByRole("button").first().click();
  const map = page.getByTestId("drive-map");
  await expect(map).toHaveClass(/leaflet-container/);
  // (The synthetic route runs due north, so its box is 0 px wide: count, don't "see".)
  await expect(map.locator("path.route")).not.toHaveCount(0);
  await expect(map.locator("path.route-2")).not.toHaveCount(0); // the hard stop is red
  await expect(map.locator("path.event-brake")).toHaveCount(1);
  await expect(map.locator("path.pin-start")).toHaveCount(1);
  await expect(map.locator("path.pin-end")).toHaveCount(1);
  await expect(map.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  // Only the origin goes to OpenStreetMap, never the page path.
  const referer = await tiles[0].headerValue("referer");
  expect(referer).toBe("http://localhost:4173/");
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
  await expect(page.locator(".tabs button[aria-current='page']")).toHaveText("Drives");
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
