import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const VERSION = readFileSync(new URL("../../js/version.js", import.meta.url), "utf8").match(
  /VERSION = "([^"]+)"/,
)[1];

// Fail any test that triggers a CSP violation or a page error.
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
  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations).toEqual([]);
});

test("shows the version and the live view", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("version")).toHaveText("v" + VERSION);
  await expect(page.getByTestId("score")).toBeVisible();
});

test("live numbers fit without scrolling", async ({ page }) => {
  await page.goto("./");
  const box = await page.getByTestId("live").boundingBox();
  const viewport = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeLessThanOrEqual(viewport.width);
});

test("service worker installs its own cache and works offline", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toEqual(["smooth-ride-" + VERSION]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("version")).toHaveText("v" + VERSION);
  await context.setOffline(false);
});

test("manifest is linked and has a fixed id", async ({ page }) => {
  await page.goto("./");
  const res = await page.request.get("manifest.webmanifest");
  const manifest = await res.json();
  expect(manifest.id).toBe("/smooth-ride/");
});

test("export then import restores data", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.evaluate(() => localStorage.setItem("smooth-ride.test", JSON.stringify({ a: 1 })));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^smooth-ride-export-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();

  await page.evaluate(() => localStorage.removeItem("smooth-ride.test"));
  page.once("dialog", (d) => d.accept());
  await page.locator("#import-file").setInputFiles(path);
  await expect(page.locator("#backup-status")).toContainText("Imported");
  const restored = await page.evaluate(() => localStorage.getItem("smooth-ride.test"));
  expect(JSON.parse(restored)).toEqual({ a: 1 });
});

test("import rejects a foreign file and shows the message as text", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "x.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"app":"<b>evil</b>","format":1,"data":{}}'),
  });
  await expect(page.locator("#backup-status")).toContainText("not a Smooth Ride export");
  await expect(page.locator("#backup-status b")).toHaveCount(0);
});
