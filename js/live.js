// Live recording: GPS → analyzer → big numbers. Keeps the screen on while recording.
import { createAnalyzer } from "./core/analysis.js";
import { makeDrive, finalizeDrive, packFix, unpackFix } from "./core/drives.js";
import { courseDifficulty } from "./core/difficulty.js";
import { fmtSpeed, fmtNumber, fmtDuration } from "./core/format.js";
import { db } from "./db.js";
import { setReadout, setBars, setTone } from "./lcd.js";

const SAVE_EVERY = 10; // fixes; an in-progress drive survives a crash or reload

export function createRecorder({ els, onStopped, car = null }) {
  let watchId = null;
  let wakeLock = null;
  let drive = null;
  let analyzer = null;
  let sinceSave = 0;
  let startedAt = 0;
  let clock = null;
  let difficulty = null; // trip so far, 0-10; null under 1 km

  const recording = () => watchId !== null;

  /** "Recording 12:04" in the header while a drive is recorded. */
  function tick() {
    els.timer.textContent = `Recording ${fmtDuration((Date.now() - startedAt) / 1000)}`;
  }

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
    const trip = analyzer.summary().score; // the drive so far; null until 30 s and 0.2 km
    setReadout(els.score, l.score == null ? "--" : String(l.score));
    els.score.parentElement.classList.toggle("wide", l.score >= 100);
    setBars(l.score, els.arch, els.bar);
    setTone(l.score, els.score, els.arch, els.bar);
    setReadout(els.trip, trip == null ? "--" : String(trip));
    setTone(trip, els.trip);
    setReadout(els.difficulty, difficulty == null ? "--" : fmtNumber(difficulty, 1));
    // With the car connected, the jerk tile shows live fuel use instead (js/car.js).
    if (!car?.showsFuel()) setReadout(els.jerk, fmtNumber(l.rmsJerk, 1));
    setReadout(els.events, String(l.harsh), 1);
    setReadout(els.speed, fmtSpeed(l.speed), 3);
  }

  function resetDisplay() {
    setReadout(els.score, "--");
    els.score.parentElement.classList.remove("wide");
    setBars(null, els.arch, els.bar);
    setTone(null, els.score, els.arch, els.bar, els.trip);
    setReadout(els.trip, "--");
    setReadout(els.difficulty, "--");
    if (!car?.showsFuel()) setReadout(els.jerk, "--");
    setReadout(els.events, "0", 1);
    setReadout(els.speed, "--", 3);
  }

  async function onPosition(pos) {
    const c = pos.coords;
    const fix = {
      t: pos.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      speed: c.speed ?? null,
      accuracy: c.accuracy ?? null,
      altitude: c.altitude ?? null, // metres; for course difficulty (climb)
    };
    const sample = analyzer.push(fix);
    if (!sample) {
      setStatus(fix.accuracy > 30 ? `Weak GPS (±${Math.round(fix.accuracy)} m)` : "");
      return;
    }
    drive.fixes.push(packFix(fix));
    // Course difficulty of the trip so far; every 10 fixes is plenty (it changes slowly).
    if (drive.fixes.length % 10 === 0) {
      difficulty = courseDifficulty(drive.fixes.map(unpackFix))?.difficulty ?? null;
    }
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
    difficulty = null;
    sinceSave = 0;
    resetDisplay();
    car?.startCapture(); // car data, if connected now or later during the drive
    await db.put(drive);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
    els.toggle.textContent = "Stop drive";
    els.toggle.classList.add("recording");
    setStatus("Waiting for GPS…");
    startedAt = Date.now();
    tick();
    els.timer.hidden = false;
    clock = setInterval(tick, 1000);
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
    els.toggle.textContent = "Start drive";
    els.toggle.classList.remove("recording");
    clearInterval(clock);
    clock = null;
    els.timer.hidden = true;
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

  resetDisplay();
  return { recording, stop };
}

function labelFor(kind) {
  return (
    { brake: "Harsh braking", accel: "Harsh acceleration", lateral: "Sharp corner" }[kind] || ""
  );
}
