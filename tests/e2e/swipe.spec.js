import { test, expect } from "@playwright/test";

/** Real touch events through the Chrome DevTools protocol. */
async function swipe(
  page,
  from,
  to,
  { steps = 12, fingers = 1, holdMs = 0, path = null, release = true } = {},
) {
  const cdp = await page.context().newCDPSession(page);
  const points = (x, y) => Array.from({ length: fingers }, (_, i) => ({ x: x + i * 40, y, id: i }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(from.x, from.y),
  });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const x = from.x + (to.x - from.x) * k;
    const y = path ? path(k, from, to) : from.y + (to.y - from.y) * k;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(x, y) });
  }
  if (release) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    return null;
  }
  // Still touching: the caller inspects the drag, then lifts the finger.
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
}

const num = (s) => Number.parseFloat(s);

const current = (page) => page.locator(".tabs button[aria-current='page']");

async function openTab(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(current(page)).toHaveText(name);
}

/** A point in the open view's empty area (not on the live numbers or the bottom bar). */
async function emptySpot(page) {
  const main = await page.locator("main").boundingBox();
  return { x: main.x + main.width / 2, y: main.y + main.height - 30 };
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
  await page.goto("./");
});

test("a long swipe left goes to the next tab, right goes back", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 150, y: p.y });
  await expect(current(page)).toHaveText("Settings");
  await expect(page.locator('.view[data-view="settings"]')).toBeVisible();
  await swipe(page, { x: p.x - 100, y: p.y }, { x: p.x + 80, y: p.y });
  await expect(current(page)).toHaveText("Drives");
});

test("mid-drag: page follows 0.55×, fades, label fades in, lights up only at 70px", async ({
  page,
}) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  const view = page.locator('.view[data-view="drives"]');
  const label = page.locator("#swipe-label");
  const settingsTab = page.locator('.tabs button[data-tab="settings"]');

  const opacity = async (loc) => num(await loc.evaluate((el) => getComputedStyle(el).opacity));
  let lift = await swipe(page, p, { x: p.x - 35, y: p.y }, { release: false });
  // The last touchmove is delivered with the next frame.
  await expect.poll(() => opacity(label)).toBeCloseTo(0.7, 2);
  expect(await opacity(view)).toBeCloseTo(0.825, 2);
  const m = await view.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(m).toBeCloseTo(-35 * 0.55, 1);
  await expect(label).toHaveText("Settings ›");
  await expect(label).not.toHaveClass(/armed/);
  await expect(settingsTab).not.toHaveClass(/swipe-armed/);
  await lift();
  await expect(current(page)).toHaveText("Drives");

  lift = await swipe(page, p, { x: p.x - 90, y: p.y }, { release: false });
  await expect(label).toHaveClass(/armed/);
  await expect(settingsTab).toHaveClass(/swipe-armed/);
  await expect.poll(() => opacity(view)).toBeCloseTo(0.65, 2);
  await lift();
  await expect(current(page)).toHaveText("Settings");
});

test("the new tab slides in with the keyframe animation", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 150, y: p.y });
  const settings = page.locator('.view[data-view="settings"]');
  const anim = await settings.evaluate((el) => ({
    name: getComputedStyle(el).animationName,
    from: el.style.getPropertyValue("--swipe-from"),
  }));
  expect(anim).toEqual({ name: "swipe-in", from: "40px" });
  await expect(settings).not.toHaveClass(/swipe-in/); // removed when the animation ends
});

test("with reduced motion the tab switches without sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 150, y: p.y });
  await expect(current(page)).toHaveText("Settings");
  const name = await page
    .locator('.view[data-view="settings"]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("none");
});

test("a diagonal thumb swipe switches tab", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 120, y: p.y - 60 });
  await expect(current(page)).toHaveText("Settings");
});

test("swiping works on the whole page, including the header", async ({ page }) => {
  await openTab(page, "Drives");
  test.skip(!(await page.locator(".topbar").isVisible()), "no header in the split-screen strip");
  const box = await page.locator(".topbar").boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x - 150, y: p.y });
  await expect(current(page)).toHaveText("Settings");
});

test("no swipe from the bottom bar", async ({ page }) => {
  await openTab(page, "Drives");
  const box = await page.locator(".tabs").boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x - 150, y: p.y });
  await expect(current(page)).toHaveText("Drives");
});

test("a short swipe springs back", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 50, y: p.y });
  await expect(current(page)).toHaveText("Drives");
  await expect(page.locator('.view[data-view="drives"]')).toHaveCSS("opacity", "1");
});

test("swiping past the last tab does nothing", async ({ page }) => {
  await openTab(page, "Settings");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 180, y: p.y });
  await expect(current(page)).toHaveText("Settings");
});

test("a mostly vertical movement scrolls and never switches tab", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 60, y: p.y - 200 });
  await expect(current(page)).toHaveText("Drives");
});

test("a thumb arc that drifts vertically after starting still switches", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  // Sideways first, then curving 45px down: a natural one-handed swipe.
  await swipe(
    page,
    p,
    { x: p.x - 170, y: p.y + 45 },
    { steps: 16, path: (k, a, b) => a.y + (b.y - a.y) * k * k },
  );
  await expect(current(page)).toHaveText("Settings");
});

test("holding the finger still first, then swiping, still switches", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 150, y: p.y }, { holdMs: 900 });
  await expect(current(page)).toHaveText("Settings");
});

test("two fingers never switch tab", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, { x: p.x - 60, y: p.y }, { x: p.x - 210, y: p.y }, { fingers: 2 });
  await expect(current(page)).toHaveText("Drives");
});

test("no swipe on data-noswipe areas such as a map", async ({ page }) => {
  await openTab(page, "Drives");
  await page.evaluate(() => {
    const map = document.createElement("div");
    map.setAttribute("data-noswipe", "");
    map.id = "fake-map";
    map.textContent = "map";
    map.className = "card";
    document.querySelector('.view[data-view="drives"]').prepend(map);
  });
  const box = await page.locator("#fake-map").boundingBox();
  const p = { x: box.x + box.width - 20, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x - 180, y: p.y });
  await expect(current(page)).toHaveText("Drives");
});

test("no swipe on the live driving numbers", async ({ page }) => {
  const box = await page.getByTestId("live").boundingBox();
  const p = { x: box.x + box.width - 20, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x - 200, y: p.y });
  await expect(current(page)).toHaveText("Drive");
});

test("no swipe at all while recording a drive", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0.5, longitude: 0.5 });
  await page.getByTestId("record").click();
  await expect(page.getByTestId("record")).toHaveText("Stop");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 200, y: p.y });
  await expect(current(page)).toHaveText("Drive");
  await page.getByTestId("record").click();
});

test("the page itself never scrolls, even with a long tab after a reload", async ({ page }) => {
  await openTab(page, "Settings");
  await page.reload();
  await expect(current(page)).toHaveText("Settings");
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.className = "card";
    filler.textContent = "long";
    filler.id = "filler";
    document.querySelector('.view[data-view="settings"]').append(filler);
    filler.style.height = "3000px";
  });
  const sizes = await page.evaluate(() => ({
    page: document.scrollingElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  await expect(page.locator(".tabs")).toBeInViewport();
});
