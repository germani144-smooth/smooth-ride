// Live recording: GPS → analyzer → big numbers. Keeps the screen on while recording.
import { createAnalyzer } from "./core/analysis.js";
import { makeDrive, finalizeDrive, packFix } from "./core/drives.js";
import { fmtSpeed, fmtNumber, scoreClass } from "./core/format.js";
import { db } from "./db.js";

const SAVE_EVERY = 10; // fixes; an in-progress drive survives a crash or reload

export function createRecorder({ els, onStopped, car = null }) {
  let watchId = null;
  let wakeLock = null;
  let drive = null;
  let analyzer = null;
  let sinceSave = 0;

  const recording = () => watchId !== null;

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && recording())
        wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      wakeLock = null; // not allowed right now (e.g. battery saver); recording continues
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && recording()) keepAwake();
  });

  function setStatus(text) {
    els.status.textContent = text;
  }

  function render() {
    const l = analyzer.live();
    els.score.textContent = l.score == null ? "--" : String(l.score);
    els.score.className = "metric-value " + scoreClass(l.score);
    els.jerk.textContent = fmtNumber(l.rmsJerk, 1);
    els.events.textContent = String(l.harsh);
    // With the car connected, that tile shows live fuel use instead (js/car.js).
    if (!car?.showsFuel()) els.speed.textContent = fmtSpeed(l.speed);
  }

  function resetDisplay() {
    els.score.textContent = "--";
    els.score.className = "metric-value";
    els.jerk.textContent = "--";
    els.events.textContent = "0";
    if (!car?.showsFuel()) els.speed.textContent = "--";
  }

  async function onPosition(pos) {
    const c = pos.coords;
    const fix = {
      t: pos.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      speed: c.speed ?? null,
      accuracy: c.accuracy ?? null,
    };
    const sample = analyzer.push(fix);
    if (!sample) {
      setStatus(fix.accuracy > 30 ? `Weak GPS (±${Math.round(fix.accuracy)} m)` : "");
      return;
    }
    drive.fixes.push(packFix(fix));
    setStatus(sample.event ? labelFor(sample.event) : `GPS ±${Math.round(fix.accuracy ?? 0)} m`);
    render();
    if (++sinceSave >= SAVE_EVERY) {
      sinceSave = 0;
      const rows = car?.rows();
      if (rows?.length) drive.obd = rows;
      db.put(drive).catch(() => {});
    }
  }

  function onError(err) {
    if (err.code === 1) {
      setStatus("Location permission denied. Allow it in the browser settings.");
      stop();
    } else {
      setStatus("Waiting for GPS…");
    }
  }

  async function start() {
    if (recording()) return;
    if (!("geolocation" in navigator)) {
      setStatus("This browser has no GPS access.");
      return;
    }
    drive = makeDrive({ source: "live" });
    analyzer = createAnalyzer();
    sinceSave = 0;
    resetDisplay();
    car?.startCapture(); // car data, if connected now or later during the drive
    await db.put(drive);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
    els.toggle.textContent = "Stop";
    els.toggle.classList.add("recording");
    setStatus("Waiting for GPS…");
    keepAwake();
  }

  async function stop() {
    if (!recording()) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    try {
      await wakeLock?.release();
    } catch {
      /* already released */
    }
    wakeLock = null;
    els.toggle.textContent = "Start";
    els.toggle.classList.remove("recording");
    const rows = car?.stopCapture();
    if (rows) drive.obd = rows;
    const done = finalizeDrive(drive);
    drive = null;
    if (done.fixes.length < 2) {
      await db.delete(done.id);
      setStatus("Nothing recorded.");
    } else {
      await db.put(done);
      setStatus(
        done.summary.score == null
          ? "Saved (too short to score)."
          : `Saved. Score ${done.summary.score}.`,
      );
    }
    onStopped(done);
  }

  els.toggle.addEventListener("click", () => (recording() ? stop() : start()));

  return { recording, stop };
}

function labelFor(kind) {
  return (
    { brake: "Harsh braking", accel: "Harsh acceleration", lateral: "Sharp corner" }[kind] || ""
  );
}
