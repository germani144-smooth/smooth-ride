import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// The simulated ELM327 (tests/fake-elm.js), injected as a fake Web Serial port.
const FAKE_ELM = readFileSync(new URL("../fake-elm.js", import.meta.url), "utf8").replace(
  "export function",
  "function",
);

function installFakeAdapter(page, options = {}, { noSerial = false } = {}) {
  return page.addInitScript({
    content: `(() => {
      ${FAKE_ELM}
      if (${noSerial}) { Object.defineProperty(navigator, "serial", { value: undefined, configurable: true }); return; }
      const elm = createFakeElm(${JSON.stringify(options)});
      window.__elm = elm;
      window.__elmCommands = [];
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      let granted = false;
      const port = {
        async open() {
          let toPage;
          let buf = "";
          this.readable = new ReadableStream({ start(c) { toPage = c; } });
          this.writable = new WritableStream({
            write(chunk) {
              buf += dec.decode(chunk);
              let i;
              while ((i = buf.indexOf("\\r")) >= 0) {
                const cmd = buf.slice(0, i);
                buf = buf.slice(i + 1);
                window.__elmCommands.push(cmd);
                setTimeout(() => toPage.enqueue(enc.encode(elm.respond(cmd))), 3);
              }
            },
          });
        },
        async close() {},
      };
      Object.defineProperty(navigator, "serial", {
        configurable: true,
        value: {
          async getPorts() { return granted ? [port] : []; },
          async requestPort() { granted = true; return port; },
        },
      });
    })();`,
  });
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 204 }));
});

test("connects to the adapter and shows live fuel use", async ({ page }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page);
  await page.goto("./");
  await page.getByTestId("car-connect").click();
  await expect(page.locator("#car-status")).toHaveText("Car connected · ELM327 v1.5");
  await expect(page.getByTestId("car-connect")).toHaveText("Disconnect car");
  // 6.2 g/s of air at 50 km/h: 6.2·3600/(14.7·740) = 2.05 L/h → 4.1 L/100 km.
  await expect(page.getByTestId("speed-label")).toHaveText("L/100");
  await expect(page.getByTestId("speed")).toHaveText("4.1");
  await expect(page.getByTestId("car-rpm")).toHaveText("1800 rpm");
  const cmds = await page.evaluate(() => window.__elmCommands);
  expect(cmds.slice(0, 8)).toEqual([
    "ATZ",
    "ATE0",
    "ATL0",
    "ATS0",
    "ATH0",
    "ATAT1",
    "ATSP0",
    "0100",
  ]);

  await page.getByTestId("car-connect").click();
  await expect(page.getByTestId("car-connect")).toHaveText("Connect car");
  await expect(page.getByTestId("speed-label")).toHaveText("km/h");
});

test("shows L/h while standing still", async ({ page }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page, { car: { speed: 0, rpm: 800, maf: 2.5 } });
  await page.goto("./");
  await page.getByTestId("car-connect").click();
  await expect(page.getByTestId("speed-label")).toHaveText("L/h");
  await expect(page.getByTestId("speed")).toHaveText("0.8"); // 2.5·3600/10878
});

test("a recorded drive keeps the car data", async ({ page, context }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0.5, longitude: 0.5 });
  await page.goto("./");
  await page.getByTestId("car-connect").click();
  await expect(page.locator("#car-status")).toContainText("Car connected");
  await page.getByTestId("record").click();
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(350);
    await context.setGeolocation({ latitude: 0.5 + (i * 5) / 111195, longitude: 0.5 });
  }
  // The speed tile shows fuel while the car is connected, even while recording.
  await expect(page.getByTestId("speed-label")).toHaveText("L/100");
  await page.getByTestId("record").click();
  await expect(page.locator("#record-status")).toContainText("Saved");

  await page.getByRole("button", { name: "Drives", exact: true }).click();
  await page.getByTestId("drive").getByRole("button").first().click();
  const car = page.getByTestId("car-stats");
  await expect(car).toBeVisible();
  await expect(car.locator(".stat", { hasText: "Avg rpm" }).locator(".stat-value")).toHaveText(
    "1800",
  );
  const litres = Number(
    await car.locator(".stat", { hasText: "Fuel used L" }).locator(".stat-value").textContent(),
  );
  expect(litres).toBeGreaterThanOrEqual(0);
});

test("the second connection skips the chooser", async ({ page }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page);
  await page.goto("./");
  await page.evaluate(() => {
    const s = navigator.serial;
    window.__chooser = 0;
    const orig = s.requestPort.bind(s);
    s.requestPort = async (o) => {
      window.__chooser++;
      return orig(o);
    };
  });
  const btn = page.getByTestId("car-connect");
  await btn.click();
  await expect(btn).toHaveText("Disconnect car");
  await btn.click();
  await expect(btn).toHaveText("Connect car");
  await btn.click();
  await expect(btn).toHaveText("Disconnect car");
  expect(await page.evaluate(() => window.__chooser)).toBe(1);
});

test("ignition off gives a clear message", async ({ page }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page, { noCar: true });
  await page.goto("./");
  await page.getByTestId("car-connect").click();
  await expect(page.locator("#car-status")).toContainText("Is the ignition on?");
  await expect(page.getByTestId("car-connect")).toHaveText("Connect car");
});

test("a browser without Bluetooth serial says so", async ({ page }) => {
  test.skip(test.info().project.name === "split-screen", "Connect is done in full view");
  await installFakeAdapter(page, {}, { noSerial: true });
  await page.goto("./");
  await page.getByTestId("car-connect").click();
  await expect(page.locator("#car-status")).toContainText("Chrome on Android");
});

test("the split-screen strip hides the car bar", async ({ page }) => {
  test.skip(test.info().project.name !== "split-screen", "strip only");
  await page.goto("./");
  await expect(page.getByTestId("car-bar")).toBeHidden();
  await expect(page.getByTestId("record")).toBeInViewport();
});
