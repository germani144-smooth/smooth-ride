// Car connection: Connect button, polling loop, live consumption, rows for the drive.
import { createElmSession } from "./core/elm.js";
import { packRow, createConsumption } from "./core/car.js";
import { fmtNumber } from "./core/format.js";
import { serialAvailable, openAdapter } from "./obd-serial.js";
import { setReadout } from "./lcd.js";

const MIN_CYCLE_MS = 250; // don't hammer the adapter faster than this

export function createCar({ els }) {
  let link = null;
  let session = null;
  let running = false;
  let capture = null; // rows for the drive being recorded
  let consumption = createConsumption();
  let showingFuel = false;
  let misses = 0;

  const connected = () => running;

  function setStatus(text) {
    els.status.textContent = text;
  }

  function showFuel(on) {
    showingFuel = on;
    if (!on) {
      els.metricLabel.textContent = "km/h";
      setReadout(els.metric, "--", 3);
    }
  }

  function renderRow(row) {
    if (!session.hasFuel) return;
    const c = consumption.push(row);
    if (!c) return;
    showFuel(true);
    setReadout(els.metric, fmtNumber(c.value, 1), 3);
    els.metricLabel.textContent = c.unit;
  }

  async function loop() {
    while (running) {
      const started = Date.now();
      let row;
      try {
        row = await session.poll();
      } catch {
        row = null;
      }
      if (!running) break;
      if (row && (row.rpm != null || row.speed != null)) {
        misses = 0;
        if (capture) capture.push(packRow(row));
        renderRow(row);
        els.rpm.textContent = row.rpm == null ? "" : `${Math.round(row.rpm)} rpm`;
      } else if (++misses === 5) {
        setStatus("Car not answering (ignition off?)");
      }
      if (misses === 0 && els.status.textContent.startsWith("Car not")) setStatus("Car connected");
      const wait = MIN_CYCLE_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  async function connect() {
    if (running) return;
    if (!serialAvailable()) {
      setStatus("This browser can't reach Bluetooth adapters. Use Chrome on Android.");
      return;
    }
    els.button.disabled = true;
    setStatus("Connecting…");
    try {
      link = await openAdapter({ onClose: () => running && lost() });
      session = createElmSession(link);
      const info = await session.init();
      running = true;
      misses = 0;
      consumption = createConsumption();
      els.button.textContent = "Disconnect car";
      setStatus(
        `Car connected${info.version ? " · " + info.version : ""}` +
          (session.hasFuel ? "" : " · this car doesn't report fuel use"),
      );
      loop();
    } catch (err) {
      await link?.close();
      link = null;
      session = null;
      setStatus(
        err && err.name === "NotFoundError"
          ? "No adapter chosen."
          : `Couldn't connect: ${err?.message || err}`,
      );
    } finally {
      els.button.disabled = false;
    }
  }

  function lost() {
    running = false;
    link = null;
    showFuel(false);
    els.rpm.textContent = "";
    els.button.textContent = "Connect car";
    setStatus("Car disconnected.");
  }

  async function disconnect() {
    running = false;
    const l = link;
    link = null;
    await l?.close();
    showFuel(false);
    els.rpm.textContent = "";
    els.button.textContent = "Connect car";
    setStatus("");
  }

  els.button.addEventListener("click", () => (running ? disconnect() : connect()));

  return {
    connected,
    /** The live metric shows fuel instead of GPS speed while this is true. */
    showsFuel: () => running && showingFuel,
    startCapture() {
      capture = [];
    },
    rows: () => (capture ? capture.slice() : null),
    stopCapture() {
      const rows = capture;
      capture = null;
      return rows && rows.length ? rows : null;
    },
  };
}
