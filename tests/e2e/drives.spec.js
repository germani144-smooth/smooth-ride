import { test, expect } from "@playwright/test";

// Synthetic coordinates only (open sea near 0,0), never real places.
const BASE = { latitude: 0.5, longitude: 0.5 };
const M_PER_DEG = 111195;

/** A synthetic GPX: 1 Hz, cruise then a hard stop. */
function syntheticGpx(seconds = 120) {
  const pts = [];
  let lat = BASE.latitude;
  let prev = 20;
  for (let i = 0; i <= seconds; i++) {
    const v = i < 80 ? 20 : Math.max(0, 20 - 6 * (i - 80));
    if (i > 0) lat += (prev + v) / 2 / M_PER_DEG;
    prev = v;
    const t = new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString();
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${BASE.longitude}"><time>${t}</time></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>Test &lt;b&gt;run&lt;/b&gt;</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(e.violatedDirective + " " + e.blockedURI),
    );
  });
  page.on("pageerror", (err) => {
    throw err;
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test("Start/Stop is visible without scrolling", async ({ page }) => {
  await page.goto("./");
  const box = await page.getByTestId("record").boundingBox();
  const vp = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test("records a drive from GPS and lists it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(BASE);
  await page.goto("./");
  await page.getByTestId("record").click();
  await expect(page.getByTestId("record")).toHaveText("Stop");

  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(350);
    await context.setGeolocation({
      latitude: BASE.latitude + (i * 5) / M_PER_DEG,
      longitude: BASE.longitude,
    });
  }
  await expect(page.getByTestId("speed")).not.toHaveText("--");
  await page.getByTestId("record").click();
  await expect(page.getByTestId("record")).toHaveText("Start");
  await expect(page.locator("#record-status")).toContainText("Saved");

  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await expect(page.getByTestId("drive")).toHaveCount(1);
  await expect(page.getByTestId("drive")).toContainText("Live");
});

test("imports a GPX, shows its stats, deletes it", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "test.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(syntheticGpx()),
  });
  await expect(page.locator("#gpx-status")).toContainText("Imported 1 drive");
  const drive = page.getByTestId("drive");
  await expect(drive).toHaveCount(1);
  // Name is shown as text, never as HTML.
  await expect(drive).toContainText("Test <b>run</b>");
  await expect(drive.locator("b")).toHaveCount(0);
  await expect(drive).toContainText("km");

  await drive.getByRole("button").first().click();
  const detail = page.getByTestId("drive-detail");
  await expect(detail).toContainText("Harsh brakes");
  await expect(
    detail.locator(".stat", { hasText: "Harsh brakes" }).locator(".stat-value"),
  ).toHaveText("1");

  page.once("dialog", (d) => d.accept());
  await detail.getByRole("button", { name: "Delete drive" }).click();
  await expect(page.getByTestId("drive")).toHaveCount(0);
});

test("a broken GPX shows an error and imports nothing", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "bad.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from("<html>nope</html>"),
  });
  await expect(page.locator("#gpx-status")).toContainText("not a GPX file");
  await expect(page.getByTestId("drive")).toHaveCount(0);
});

test("backup round-trips drives", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "test.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(syntheticGpx()),
  });
  await expect(page.getByTestId("drive")).toHaveCount(1);

  await page.getByRole("button", { name: "Settings" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const path = await (await dl).path();
  await expect(page.locator("#backup-status")).toContainText("Exported 1 drives");

  // Wipe drives, then import the backup.
  await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("smooth-ride.db");
        r.onsuccess = () => {
          const tx = r.result.transaction("drives", "readwrite");
          tx.objectStore("drives").clear();
          tx.oncomplete = res;
        };
      }),
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#import-file").setInputFiles(path);
  await expect(page.locator("#backup-status")).toContainText("Imported 1 drives");
  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await expect(page.getByTestId("drive")).toHaveCount(1);
});
