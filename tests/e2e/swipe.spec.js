import { test, expect } from "@playwright/test";

/** Real touch events through the Chrome DevTools protocol. */
async function swipe(page, from, to, { steps = 12, fingers = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const points = (x, y) => Array.from({ length: fingers }, (_, i) => ({ x: x + i * 40, y, id: i }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(from.x, from.y),
  });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(x, y) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

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

test("vertical movement wins over a sideways swipe", async ({ page }) => {
  await openTab(page, "Drives");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 150, y: p.y - 60 });
  await expect(current(page)).toHaveText("Drives");
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
