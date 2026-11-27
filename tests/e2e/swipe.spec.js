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

/** On the Drive tab: the empty space beside Connect car (null in the split-screen strip,
 *  where the whole tab is the live display and Start/Stop). */
async function driveSpot(page) {
  const bar = page.getByTestId("car-bar");
  if (!(await bar.isVisible())) return null;
  const box = await bar.boundingBox();
  return { x: box.x + box.width - 30, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
  await page.goto("./");
});

test("a long swipe right on History goes to Drive, left on Drive goes back", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 150, y: p.y });
  await expect(current(page)).toHaveText("Drive");
  await expect(page.locator('.view[data-view="drive"]')).toBeVisible();
  const d = await driveSpot(page);
  test.skip(!d, "the split-screen strip has no free space on the Drive tab");
  await swipe(page, d, { x: d.x - 160, y: d.y });
  await expect(current(page)).toHaveText("History");
});

test("mid-drag: page follows 0.55×, fades, label fades in, lights up only at 70px", async ({
  page,
}) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  const view = page.locator('.view[data-view="history"]');
  const label = page.locator("#swipe-label");
  const driveTab = page.locator('.tabs button[data-tab="drive"]');
  const opacity = async (loc) => num(await loc.evaluate((el) => getComputedStyle(el).opacity));

  let lift = await swipe(page, p, { x: p.x + 35, y: p.y }, { release: false });
  // The last touchmove is delivered with the next frame.
  await expect.poll(() => opacity(label)).toBeCloseTo(0.7, 2);
  expect(await opacity(view)).toBeCloseTo(0.825, 2);
  const m = await view.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(m).toBeCloseTo(35 * 0.55, 1);
  await expect(label).toHaveText("‹ Drive");
  await expect(label).not.toHaveClass(/armed/);
  await expect(driveTab).not.toHaveClass(/swipe-armed/);
  await lift();
  await expect(current(page)).toHaveText("History");

  lift = await swipe(page, p, { x: p.x + 90, y: p.y }, { release: false });
  await expect(label).toHaveClass(/armed/);
  await expect(driveTab).toHaveClass(/swipe-armed/);
  await expect.poll(() => opacity(view)).toBeCloseTo(0.65, 2);
  await lift();
  await expect(current(page)).toHaveText("Drive");
});

test("the new tab slides in with the keyframe animation", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 150, y: p.y });
  const drive = page.locator('.view[data-view="drive"]');
  const anim = await drive.evaluate((el) => ({
    name: getComputedStyle(el).animationName,
    from: el.style.getPropertyValue("--swipe-from"),
  }));
  expect(anim).toEqual({ name: "swipe-in", from: "-40px" });
  await expect(drive).not.toHaveClass(/swipe-in/); // removed when the animation ends
});

test("with reduced motion the tab switches without sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 150, y: p.y });
  await expect(current(page)).toHaveText("Drive");
  const name = await page
    .locator('.view[data-view="drive"]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("none");
});

test("a diagonal thumb swipe switches tab", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 120, y: p.y - 60 });
  await expect(current(page)).toHaveText("Drive");
});

test("swiping works on the whole page, including the header", async ({ page }) => {
  await openTab(page, "History");
  test.skip(!(await page.locator(".topbar").isVisible()), "no header in the split-screen strip");
  const box = await page.locator(".brand").boundingBox();
  const p = { x: box.x + 10, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x + 150, y: p.y });
  await expect(current(page)).toHaveText("Drive");
});

test("no swipe from the bottom bar", async ({ page }) => {
  await openTab(page, "History");
  const box = await page.locator(".tabs").boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x - 150, y: p.y });
  await swipe(page, { x: p.x - 100, y: p.y }, { x: p.x + 60, y: p.y });
  await expect(current(page)).toHaveText("History");
});

test("a short swipe springs back", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 50, y: p.y });
  await expect(current(page)).toHaveText("History");
  await expect(page.locator('.view[data-view="history"]')).toHaveCSS("opacity", "1");
});

test("swiping past the last tab does nothing", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x - 180, y: p.y });
  await expect(current(page)).toHaveText("History");
});

test("a mostly vertical movement scrolls and never switches tab", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 60, y: p.y - 200 });
  await expect(current(page)).toHaveText("History");
});

test("a thumb arc that drifts vertically after starting still switches", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  // Sideways first, then curving 45px up: a natural one-handed swipe.
  await swipe(
    page,
    p,
    { x: p.x + 170, y: p.y - 45 },
    { steps: 16, path: (k, a, b) => a.y + (b.y - a.y) * k * k },
  );
  await expect(current(page)).toHaveText("Drive");
});

test("holding the finger still first, then swiping, still switches", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 150, y: p.y }, { holdMs: 900 });
  await expect(current(page)).toHaveText("Drive");
});

test("two fingers never switch tab", async ({ page }) => {
  await openTab(page, "History");
  const p = await emptySpot(page);
  await swipe(page, { x: p.x - 100, y: p.y }, { x: p.x + 60, y: p.y }, { fingers: 2 });
  await expect(current(page)).toHaveText("History");
});

test("no swipe on data-noswipe areas such as a map", async ({ page }) => {
  await openTab(page, "History");
  await page.evaluate(() => {
    const map = document.createElement("div");
    map.setAttribute("data-noswipe", "");
    map.id = "fake-map";
    map.textContent = "map";
    map.className = "card";
    document.querySelector('.view[data-view="history"]').prepend(map);
  });
  const box = await page.locator("#fake-map").boundingBox();
  const p = { x: box.x + 20, y: box.y + box.height / 2 };
  await swipe(page, p, { x: p.x + 180, y: p.y });
  await expect(current(page)).toHaveText("History");
});

test("swiping works on the live numbers when not recording", async ({ page }) => {
  // On the dials (the score) and on the small readouts.
  for (const id of ["score", "speed"]) {
    const box = await page.getByTestId(id).boundingBox();
    const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await swipe(page, { x: p.x + 60, y: p.y }, { x: p.x - 140, y: p.y });
    await expect(current(page)).toHaveText("History");
    await page.getByRole("button", { name: "Drive", exact: true }).click();
    await expect(current(page)).toHaveText("Drive");
  }
});

test("no swipe at all while recording a drive", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0.5, longitude: 0.5 });
  const d = await driveSpot(page);
  test.skip(!d, "the split-screen strip has no free space on the Drive tab");
  await page.getByTestId("record").click();
  await expect(page.getByTestId("record")).toHaveText("Stop drive");
  await swipe(page, d, { x: d.x - 200, y: d.y });
  await expect(current(page)).toHaveText("Drive");
  // Not on the live numbers either.
  const box = await page.getByTestId("score").boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await swipe(page, { x: p.x + 60, y: p.y }, { x: p.x - 140, y: p.y });
  await expect(current(page)).toHaveText("Drive");
  await page.getByTestId("record").click();
});

test("in Settings a swipe only gives a little and switches nothing", async ({ page }) => {
  test.skip(
    !(await page.getByRole("button", { name: "Settings" }).isVisible()),
    "Settings is reached with the cog, which the split-screen strip hides",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator('.view[data-view="settings"]')).toBeVisible();
  const p = await emptySpot(page);
  await swipe(page, p, { x: p.x + 160, y: p.y });
  await swipe(page, p, { x: p.x - 160, y: p.y });
  await expect(page.locator('.view[data-view="settings"]')).toBeVisible();
  await expect(current(page)).toHaveCount(0);
});

test("the page itself never scrolls, even with a long view after a reload", async ({ page }) => {
  await openTab(page, "History");
  await page.reload();
  await expect(current(page)).toHaveText("History");
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.className = "card";
    filler.textContent = "long";
    filler.id = "filler";
    document.querySelector('.view[data-view="history"]').append(filler);
    filler.style.height = "3000px";
  });
  const sizes = await page.evaluate(() => ({
    page: document.scrollingElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  await expect(page.locator(".tabs")).toBeInViewport();
});
