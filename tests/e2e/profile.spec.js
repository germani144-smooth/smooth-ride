import { test, expect } from "@playwright/test";

const M_PER_DEG = 111195;

/** Synthetic GPX (open sea near 0.5,0.5). `hardStops` makes it rougher. */
function gpx(seconds, hardStops, startMinute) {
  const pts = [];
  let lat = 0.5;
  const stopAt = new Set(Array.from({ length: hardStops }, (_, i) => 40 + i * 40));
  let v = 0;
  let braking = 0;
  for (let i = 0; i <= seconds; i++) {
    let next = Math.min(18, v + 1);
    if (stopAt.has(i)) braking = 4;
    if (braking > 0) {
      next = Math.max(0, v - 5);
      braking--;
    }
    if (i > 0) lat += (v + next) / 2 / M_PER_DEG;
    v = next;
    const t = new Date(Date.UTC(2026, 0, 1, 10, startMinute, i)).toISOString();
    pts.push(
      `<trkpt lat="${lat.toFixed(7)}" lon="0.5"><time>${t}</time><speed>${v}</speed></trkpt>`,
    );
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

async function importGpx(page, name, text) {
  await page.locator("#gpx-file").setInputFiles({
    name,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(text),
  });
  await expect(page.locator("#gpx-status")).toContainText("Imported");
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
  for (const host of ["https://tiles.stadiamaps.com/**", "https://tile.openstreetmap.org/**"]) {
    await page.route(host, (r) => r.fulfill({ status: 204 }));
  }
  await page.goto("./");
  await page.getByRole("button", { name: "History", exact: true }).click();
});

test("no score yet, and a demo drive doesn't count", async ({ page }) => {
  const card = page.getByTestId("profile");
  await expect(card.locator(".profile-score")).toHaveText("--");
  await page.getByRole("button", { name: "Demo drive" }).click();
  await expect(page.getByTestId("drive")).toHaveCount(1);
  await expect(card.locator(".profile-score")).toHaveText("--");
});

test("the overall score weights each drive by distance", async ({ page }) => {
  await importGpx(page, "long-smooth.gpx", gpx(600, 0, 0)); // ~10 km, smooth
  await importGpx(page, "short-rough.gpx", gpx(160, 3, 20)); // ~2 km, three hard stops
  await expect(page.getByTestId("drive")).toHaveCount(2);

  const expected = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("smooth-ride.db");
        r.onsuccess = () => {
          const q = r.result.transaction("drives").objectStore("drives").getAll();
          q.onsuccess = () => {
            const s = q.result.map((d) => d.summary);
            const w = s.reduce((a, x) => a + x.score * x.distance, 0);
            const m = s.reduce((a, x) => a + x.distance, 0);
            resolve({ score: Math.round(w / m), scores: s.map((x) => x.score) });
          };
        };
      }),
  );
  // The two drives really differ, so the weighting matters.
  expect(Math.abs(expected.scores[0] - expected.scores[1])).toBeGreaterThan(10);
  const card = page.getByTestId("profile");
  await expect(card.locator(".profile-score")).toHaveText(String(expected.score));
  await expect(card).toContainText("2 drives");
  // Closer to the long drive's score than a plain average would be.
  const plain = (expected.scores[0] + expected.scores[1]) / 2;
  const long = Math.max(...expected.scores);
  expect(Math.abs(expected.score - long)).toBeLessThan(Math.abs(plain - long));
});

test("deleting a drive updates the overall score", async ({ page }) => {
  await importGpx(page, "a.gpx", gpx(300, 0, 0));
  const card = page.getByTestId("profile");
  await expect(card.locator(".profile-score")).not.toHaveText("--");
  await page.getByTestId("drive").getByRole("button").first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete drive" }).click();
  await expect(card.locator(".profile-score")).toHaveText("--");
});
