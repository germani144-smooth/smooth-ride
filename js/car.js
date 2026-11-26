// Car connection: Connect button, polling loop, the throttle bar and live consumption on the
// Drive tab, rows for the drive.
import { createElmSession } from "./core/elm.js";
import { packRow, createConsumption, createThrottleScale } from "./core/car.js";
import { fmtNumber } from "./core/format.js";
import { serialAvailable, openAdapter } from "./obd-serial.js";
import { setReadout, buildBar, setBars } from "./lcd.js";
import { t } from "./core/i18n.js";

const THROTTLE_SEGMENTS = 20;

const MIN_CYCLE_MS = 250; // don't hammer the adapter faster than this

export function createCar({ els }) {
  let link = null;
  let session = null;
  let running = false;
  let capture = null; // rows for the drive being recorded
  let consumption = createConsumption();
  let throttleScale = createThrottleScale();
  let showingFuel = false;
  let misses = 0;

  const connected = () => running;

  function setStatus(text) {
    els.status.textContent = text;
  }

  buildBar(els.throttleBar, THROTTLE_SEGMENTS);

  function showFuel(on) {
    showingFuel = on;
    if (!on) {
      els.metricLabel.textContent = t("live.jerk");
      setReadout(els.metric, "--");
    }
  }

  /** The Drive tab's car layout: throttle bar under the score (only if the car reports it). */
  function showCar(on) {
    els.live.classList.toggle("has-car", on && Boolean(session?.hasThrottle));
    els.throttle.hidden = !(on && session?.hasThrottle);
    setBars(null, els.throttleBar);
    els.throttleValue.textContent = "--";
  }

  function renderThrottle(row) {
    const percent = throttleScale.push(row.pedal ?? row.throttle);
    if (percent == null) return;
    setBars(percent, els.throttleBar);
    els.throttleValue.textContent = `${Math.round(percent)}%`;
  }

  function renderRow(row) {
    renderThrottle(row);
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
      } else if (++misses === 5) {
        setStatus(t("car.notAnswering"));
      }
      if (misses === 0 && els.status.textContent === t("car.notAnswering")) {
        setStatus(t("car.connected"));
      }
      const wait = MIN_CYCLE_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  async function connect() {
    if (running) return;
    if (!serialAvailable()) {
      setStatus(t("car.noSerial"));
      return;
    }
    els.button.disabled = true;
    setStatus(t("car.connecting"));
    try {
      link = await openAdapter({ onClose: () => running && lost() });
      session = createElmSession(link);
      const info = await session.init();
      running = true;
      misses = 0;
      consumption = createConsumption();
      throttleScale = createThrottleScale();
      els.button.textContent = t("car.disconnect");
      showCar(true);
      setStatus(
        (info.version ? t("car.connectedVersion", { version: info.version }) : t("car.connected")) +
          (session.hasFuel ? "" : ` ${t("car.noFuel")}`),
      );
      loop();
    } catch (err) {
      await link?.close();
      link = null;
      session = null;
      setStatus(
        err && err.name === "NotFoundError"
          ? t("car.noAdapter")
          : t("car.failed", { message: err?.message || err }),
      );
    } finally {
      els.button.disabled = false;
    }
  }

  function lost() {
    running = false;
    link = null;
    showFuel(false);
    showCar(false);
    els.button.textContent = t("car.connect");
    setStatus(t("car.disconnected"));
  }

  async function disconnect() {
    running = false;
    const l = link;
    link = null;
    await l?.close();
    showFuel(false);
    showCar(false);
    els.button.textContent = t("car.connect");
    setStatus("");
  }

  els.button.addEventListener("click", () => (running ? disconnect() : connect()));

  /** Texts that depend on state, after a language change. */
  function relabel() {
    els.button.textContent = running ? t("car.disconnect") : t("car.connect");
    if (!showingFuel) els.metricLabel.textContent = t("live.jerk");
  }
  relabel();

  return {
    connected,
    relabel,
    /** The jerk tile shows fuel use instead while this is true. */
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
