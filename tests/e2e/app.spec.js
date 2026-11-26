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

test("the cog opens Settings with the version, and tapping it again goes back", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("score")).toBeVisible();
  const cog = page.getByRole("button", { name: "Settings" });
  test.skip(!(await cog.isVisible()), "the split-screen strip hides the header and its cog");
  await cog.click();
  await expect(page.getByTestId("version")).toBeVisible();
  await expect(page.getByTestId("version")).toHaveText(VERSION);
  await expect(cog).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".tabs button[aria-current='page']")).toHaveCount(0);
  await cog.click();
  await expect(page.getByTestId("score")).toBeVisible();
  await expect(page.locator(".tabs button[aria-current='page']")).toHaveText("Drive");
});

test("two tabs, Drive and History; the old Drives tab opens as History", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("smooth-ride.ui.tab", '"drives"'));
  await page.goto("./");
  await expect(page.locator(".tabs button")).toHaveText(["Drive", "History"]);
  await expect(page.locator(".tabs button[aria-current='page']")).toHaveText("History");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
});

test("readouts show ghost 8s behind the digits; fonts come from our own address", async ({
  page,
}) => {
  const fonts = [];
  page.on("request", (r) => r.resourceType() === "font" && fonts.push(r.url()));
  await page.goto("./");
  await page.evaluate(() => document.fonts.ready);
  const speed = page.getByTestId("speed");
  await expect(speed).toHaveText("--");
  await expect(speed.locator("xpath=..").locator(".ghost")).toHaveText("888");
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((u) => u.startsWith("http://localhost:4173/smooth-ride/vendor/fonts/"))).toBe(
    true,
  );
  expect(await page.evaluate(() => document.fonts.check('700 40px "DSEG7 Classic"'))).toBe(true);
});

test("live numbers fit without scrolling", async ({ page }) => {
  await page.goto("./");
  const box = await page.getByTestId("live").boundingBox();
  const viewport = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeLessThanOrEqual(viewport.width);
});

test("trip score sits next to the instant score; labels are big enough to read driving", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("trip")).toHaveText("--");
  await expect(page.getByTestId("trip")).toBeVisible();
  await expect(page.getByTestId("trip")).not.toHaveClass(/tone-/);
  const labels = page.locator(".metric:visible .metric-label");
  expect(await labels.count()).toBeGreaterThanOrEqual(3);
  for (const size of await labels.evaluateAll((els) =>
    els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
  )) {
    expect(size).toBeGreaterThanOrEqual(16);
  }
});

test("service worker installs its own cache and works offline", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toEqual(["smooth-ride-" + VERSION]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("version")).toHaveText(VERSION);
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
  test.skip(
    !(await page.getByRole("button", { name: "Settings" }).isVisible()),
    "Settings is reached with the cog, which the split-screen strip hides",
  );
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
  test.skip(
    !(await page.getByRole("button", { name: "Settings" }).isVisible()),
    "Settings is reached with the cog, which the split-screen strip hides",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "x.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"app":"<b>evil</b>","format":1,"data":{}}'),
  });
  await expect(page.locator("#backup-status")).toContainText("not a Smooth Ride export");
  await expect(page.locator("#backup-status b")).toHaveCount(0);
});
