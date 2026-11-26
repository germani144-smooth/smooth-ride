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
  await expect(page.getByTestId("record")).toHaveText("Stop drive");
  // The header shows how long the drive has been recording.
  if (await page.locator(".topbar").isVisible()) {
    await expect(page.getByTestId("rec-timer")).toHaveText(/^Recording 0:0\d$/);
  }

  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(350);
    await context.setGeolocation({
      latitude: BASE.latitude + (i * 5) / M_PER_DEG,
      longitude: BASE.longitude,
    });
  }
  await expect(page.getByTestId("speed")).not.toHaveText("--");
  await page.getByTestId("record").click();
  await expect(page.getByTestId("record")).toHaveText("Start drive");
  await expect(page.locator("#record-status")).toContainText("Saved");
  await expect(page.getByTestId("rec-timer")).toBeHidden();
  // Back to the waiting display, not the last numbers of the drive.
  await expect(page.getByTestId("score")).toHaveText("--");
  await expect(page.getByTestId("speed")).toHaveText("--");
  await expect(page.getByTestId("trip")).toHaveText("--");

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("drive")).toHaveCount(1);
  await expect(page.getByTestId("drive")).toContainText("Live");
});

test("imports a GPX, shows its stats, deletes it", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "History", exact: true }).click();
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
  await page.getByRole("button", { name: "History", exact: true }).click();
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
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "test.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(syntheticGpx()),
  });
  await expect(page.getByTestId("drive")).toHaveCount(1);

  test.skip(
    !(await page.getByRole("button", { name: "Settings" }).isVisible()),
    "Settings is reached with the cog, which the split-screen strip hides",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all" }).click();
  const path = await (await dl).path();
  await expect(page.locator("#backup-status")).toContainText("Exported 1 drive to");

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
  await expect(page.locator("#backup-status")).toContainText("Imported 1 drive from");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("drive")).toHaveCount(1);
});

test("each drive in History has a strip showing where it went firm or harsh", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles({
    name: "test.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(syntheticGpx()),
  });
  const ribbon = page.getByTestId("drive").getByTestId("ribbon");
  await expect(ribbon.locator("i")).toHaveCount(60);
  // The synthetic drive cruises, then stops hard at the end: harsh only near the end.
  await expect(ribbon.locator("i.r2")).not.toHaveCount(0);
  const firstHarsh = await ribbon
    .locator("i")
    .evaluateAll((cells) => cells.findIndex((c) => c.classList.contains("r2")));
  expect(firstHarsh).toBeGreaterThan(40);
});

/** Import n copies of the synthetic GPX drive (as separate files) on the History tab. */
async function importDrives(page, n) {
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator("#gpx-file").setInputFiles(
    Array.from({ length: n }, (_, i) => ({
      name: `drive-${i + 1}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(
        syntheticGpx(120 + i * 30).replace("Test &lt;b&gt;run&lt;/b&gt;", `Run ${i + 1}`),
      ),
    })),
  );
  await expect(page.getByTestId("drive")).toHaveCount(n);
}

async function openSettings(page) {
  const cog = page.getByRole("button", { name: "Settings" });
  test.skip(!(await cog.isVisible()), "Settings is reached with the cog, hidden in the strip");
  await cog.click();
}

test("History scores are coloured like the live score", async ({ page }) => {
  await page.goto("./");
  await importDrives(page, 1);
  const digits = page.getByTestId("drive").locator(".drive-score .digits");
  await expect(digits).toHaveClass(/tone-(low|mid|high)/);
  await expect(page.locator(".profile-score")).toHaveClass(/tone-(low|mid|high)/);
});

test("export chosen drives; importing them adds without removing the others", async ({ page }) => {
  await page.goto("./");
  await importDrives(page, 3);
  await openSettings(page);
  await page.getByRole("button", { name: "Choose drives" }).click();
  const picks = page.getByTestId("pick");
  await expect(picks).toHaveCount(3);
  await expect(page.locator("#export-selected")).toBeDisabled();
  await picks.filter({ hasText: "Run 2" }).locator("input").check();
  await expect(page.locator("#export-selected")).toHaveText("Export 1 drive");
  const dl = page.waitForEvent("download");
  await page.locator("#export-selected").click();
  const file = await (await dl).path();
  await expect(page.locator("#backup-status")).toContainText("Exported 1 drive to");
  await expect(page.getByTestId("export-picker")).toBeHidden();
  const backup = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  expect(backup.partial).toBe(true);
  expect(backup.data.drives.map((d) => d.name)).toEqual(["Run 2"]);
  expect(backup.data.store).toBeUndefined();

  // Delete Run 2 on the phone, then import it back: the other two must stay.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByTestId("drive").filter({ hasText: "Run 2" }).locator(".drive-row").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete drive" }).click();
  await expect(page.getByTestId("drive")).toHaveCount(2);
  await openSettings(page);
  page.once("dialog", (d) => d.accept());
  await page.locator("#import-file").setInputFiles(file);
  await expect(page.locator("#backup-status")).toContainText("Added 1 drive");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("drive")).toHaveCount(3);

  // Select all picks every drive.
  await openSettings(page);
  await page.getByRole("button", { name: "Choose drives" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.locator("#export-selected")).toHaveText("Export 3 drives");
});

test("language: Danish and Brazilian Portuguese, remembered after a reload", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("record")).toHaveText("Start drive");
  await openSettings(page);
  await page.getByTestId("language").selectOption("da");
  await expect(page.locator("html")).toHaveAttribute("lang", "da");
  await expect(page.getByRole("heading", { name: "Indstillinger" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eksportér alle" })).toBeVisible();
  await expect(page.getByTestId("record")).toHaveText("Start tur");
  await expect(page.getByTestId("car-connect")).toHaveText("Forbind bil");
  await expect(page.locator('.tabs button[data-tab="history"]')).toHaveText("Historik");

  await page.reload();
  await expect(page.getByTestId("record")).toHaveText("Start tur");
  await expect(page.locator(".metric-trip .metric-label")).toHaveText("Turens score");

  await openSettings(page);
  await page.getByTestId("language").selectOption("pt-BR");
  await expect(page.getByTestId("record")).toHaveText("Iniciar viagem");
  await page.locator('.tabs button[data-tab="history"]').click();
  await page.getByRole("button", { name: "Viagem demo" }).click();
  await expect(page.getByTestId("drive").first()).toContainText("Viagem demo (simulada)");
  await expect(page.getByTestId("course-stats")).toContainText("Dificuldade do percurso");

  await openSettings(page);
  await page.getByTestId("language").selectOption("en");
  await expect(page.getByTestId("record")).toHaveText("Start drive");
});

test("About explains how it works and how to score well", async ({ page }) => {
  await page.goto("./");
  await openSettings(page);
  const about = page.getByTestId("about");
  await expect(about.locator("summary")).toHaveCount(6);
  await about.getByText("How to get a good score").click();
  await expect(about.getByText("Look far ahead.", { exact: false })).toBeVisible();
  await about.getByText("The score", { exact: true }).click();
  await expect(about.getByText("green from 90", { exact: false })).toBeVisible();
});
