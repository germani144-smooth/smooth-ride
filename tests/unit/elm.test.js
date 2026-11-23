import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanReply,
  pidBytes,
  decodePid,
  parseSupported,
  fuelRateLh,
  createElmSession,
  PETROL,
} from "../../js/core/elm.js";
import { summarizeCar, packRow, isValidRows, createConsumption } from "../../js/core/car.js";
import { createFakeElm } from "../fake-elm.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const transportFor = (elm, log = []) => ({
  send: async (c) => {
    log.push(c);
    return elm.respond(c);
  },
});

test("cleanReply drops prompt, echo, SEARCHING and blank lines", () => {
  assert.deepEqual(cleanReply("010C\r41 0C 1A F8\r\r>", "010C"), {
    lines: ["41 0C 1A F8"],
    error: null,
  });
  assert.deepEqual(cleanReply("SEARCHING...\r410D32\r\r>", "010D").lines, ["410D32"]);
  assert.equal(cleanReply("NO DATA\r\r>", "015E").error, "NO DATA");
  assert.equal(cleanReply("SEARCHING...\rUNABLE TO CONNECT\r>", "0100").error, "UNABLE TO CONNECT");
  assert.equal(cleanReply("?\r>", "XYZ").error, "?");
});

test("PID decoding (standard SAE formulas)", () => {
  close(decodePid("0C", "41 0C 1A F8\r>"), (0x1a * 256 + 0xf8) / 4); // 1726 rpm
  assert.equal(decodePid("0D", "410D32>"), 50);
  close(decodePid("10", "4110026C>"), 6.2);
  close(decodePid("11", "41112E>"), (0x2e * 100) / 255);
  assert.equal(decodePid("05", "41057E>"), 86);
  close(decodePid("5E", "415E0032>"), 2.5);
  assert.equal(decodePid("0C", "NO DATA\r>"), null);
});

test("multiple ECUs and headers: first matching reply wins", () => {
  assert.deepEqual(pidBytes("7E8 04 41 0D 32\r7E9 04 41 0D 33\r>", "0D"), [0x32]);
  assert.deepEqual(pidBytes("410D32\r410D33\r>", "0D"), [0x32]);
});

test("supported-PID bitmask", () => {
  // BE 1F A8 13: the classic example → 01,03,04,05,06,07,0C,0D,0E,0F,10,11,13,15,1C,1F,20
  const s = parseSupported("41 00 BE 1F A8 13\r>", 0x00);
  for (const p of ["01", "04", "05", "0C", "0D", "10", "11", "20"]) assert.ok(s.has(p), p);
  assert.ok(!s.has("02"));
  assert.ok(!s.has("5E"));
});

test("fuel rate from MAF uses petrol's 14.7 AFR and 740 g/L", () => {
  close(fuelRateLh({ maf: 10 }), (10 * 3600) / (PETROL.afr * PETROL.density));
  assert.equal(fuelRateLh({ maf: 10, fuelRate: 3 }), 3); // car's own PID wins
  assert.equal(fuelRateLh({ maf: null, fuelRate: null }), null);
});

test("session: init against a clone, then poll a full row", async () => {
  const elm = createFakeElm();
  const log = [];
  let t = 1000;
  const s = createElmSession(transportFor(elm, log), { now: () => t });
  const info = await s.init();
  assert.equal(info.version, "ELM327 v1.5");
  assert.ok(info.supported.includes("0C"));
  assert.deepEqual(log.slice(0, 7), ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0"]);
  assert.equal(s.hasFuel, true);
  assert.deepEqual(s.plan(), { fast: ["0D", "0C", "11", "04", "10"], slow: ["05"] });

  const row = await s.poll();
  assert.equal(row.t, 1000);
  assert.equal(row.speed, 50);
  assert.equal(row.rpm, 1800);
  close(row.maf, 6.2);
  assert.equal(row.coolant, 88);
  close(row.fuelRate, (6.2 * 3600) / (14.7 * 740), 1e-6);
});

test("session prefers the car's fuel-rate PID when it has one", async () => {
  // 5E sits in the 41-60 block, reached via 0120 → "40" → 0140.
  const elm = createFakeElm({
    supported: ["0C", "0D", "10", "20", "40", "5E"],
    car: { fuelRate: 4 },
  });
  const s = createElmSession(transportFor(elm));
  await s.init();
  assert.ok(s.supported.has("5E"));
  assert.ok(s.plan().fast.includes("5E"));
  assert.ok(!s.plan().fast.includes("10"));
  close((await s.poll()).fuelRate, 4);
});

test("session: ignition off gives a clear message", async () => {
  const s = createElmSession(transportFor(createFakeElm({ noCar: true })));
  await assert.rejects(() => s.init(), /ignition/);
});

test("session: a car without MAF or fuel PID has no fuel data", async () => {
  const s = createElmSession(transportFor(createFakeElm({ supported: ["0C", "0D", "11"] })));
  await s.init();
  assert.equal(s.hasFuel, false);
  assert.equal((await s.poll()).fuelRate, null);
});

test("summarizeCar integrates fuel and reports L/100 km", () => {
  // 10 minutes at a steady 6 L/h over 8 km: 1 L, 12.5 L/100 km.
  const rows = [];
  for (let i = 0; i <= 600; i++) {
    rows.push(
      packRow({
        t: i * 1000,
        speed: 48,
        rpm: 1800,
        maf: null,
        throttle: 15,
        load: 30,
        coolant: 90,
        fuelRate: 6,
      }),
    );
  }
  const c = summarizeCar(rows, 8000);
  close(c.litres, 1, 1e-9);
  close(c.lPer100km, 12.5, 1e-9);
  assert.equal(c.idleLitres, 0);
  assert.equal(c.avgRpm, 1800);
  assert.equal(c.coldShare, 0);
});

test("summarizeCar: idle fuel, cold engine, gaps not integrated", () => {
  const rows = [
    [0, 0, 800, null, 0, 20, 40, 0.9],
    [60000, 0, 800, null, 0, 20, 50, 0.9], // a 60 s gap: skipped
    [61000, 0, 800, null, 0, 20, 60, 0.9],
    [62000, 30, 2000, null, 20, 40, 80, 5],
  ];
  const c = summarizeCar(rows, 500);
  close(c.idleLitres, (0.9 * 1) / 3600);
  assert.ok(c.coldShare > 0.4);
  assert.equal(c.startCoolant, 40);
  assert.ok(isValidRows(rows));
  assert.equal(isValidRows([[1, "x", 0, 0, 0, 0, 0, 0]]), false);
  assert.equal(summarizeCar([], 1000), null);
});

test("live consumption: L/100 km moving, L/h stopped", () => {
  const c = createConsumption();
  assert.equal(c.value(), null);
  const v = c.push({ t: 0, speed: 60, fuelRate: 6 });
  assert.deepEqual(v, { value: 10, unit: "L/100" });
  const stopped = createConsumption();
  assert.deepEqual(stopped.push({ t: 0, speed: 0, fuelRate: 0.8 }), { value: 0.8, unit: "L/h" });
});

test("drives carry car data: summary on finalize, validated on import", async () => {
  const { makeDrive, finalizeDrive, isValidDrive } = await import("../../js/core/drives.js");
  const fixes = [];
  for (let i = 0; i <= 120; i++) {
    fixes.push({ t: i * 1000, lat: 0.5 + (i * 15) / 111195, lon: 0.5, speed: 15, accuracy: 5 });
  }
  const obd = [];
  for (let i = 0; i <= 120; i++)
    obd.push(
      packRow({
        t: i * 1000,
        speed: 54,
        rpm: 2000,
        maf: 8,
        throttle: 20,
        load: 40,
        coolant: 90,
        fuelRate: 4.5,
      }),
    );
  const d = finalizeDrive({ ...makeDrive({ source: "live", fixes }), obd });
  assert.ok(d.summary.car);
  close(d.summary.car.litres, (4.5 * 120) / 3600, 1e-9);
  assert.ok(d.summary.car.lPer100km > 8 && d.summary.car.lPer100km < 9);
  assert.ok(isValidDrive(d));
  assert.equal(isValidDrive({ ...d, obd: [["bad"]] }), false);
  assert.equal(finalizeDrive(makeDrive({ source: "gpx", fixes })).summary.car, null);
});
