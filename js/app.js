// UI wiring only. Logic lives in js/core/ (pure, unit tested).
import { VERSION } from "./version.js";
import { createStore, memoryBackend } from "./core/storage.js";
import { buildBackup, backupFileName, parseBackup } from "./core/backup.js";
import { createReloadGuard } from "./core/update.js";
import { isValidDrive, finalizeDrive } from "./core/drives.js";
import { db } from "./db.js";
import { createRecorder } from "./live.js";
import { createDrivesView } from "./drives.js";
import { createSwipe } from "./swipe.js";
import { createCar } from "./car.js";

const $ = (sel) => document.querySelector(sel);

function localBackend() {
  try {
    const ls = window.localStorage;
    ls.getItem("smooth-ride.probe");
    return ls;
  } catch {
    return memoryBackend();
  }
}
const store = createStore(localBackend());
let guard = null;

// ---- Version ----
document
  .querySelectorAll('[data-testid="version"], [data-testid="settings-version"]')
  .forEach((el) => {
    el.textContent = "v" + VERSION;
  });

// ---- Drives and recording ----
const drivesView = createDrivesView({
  list: $("#drive-list"),
  profile: $("#profile"),
  importInput: $("#gpx-file"),
  demoButton: $("#demo-btn"),
  status: $("#gpx-status"),
  isRecording: () => recorder.recording(),
});

// OBD-II car data through a paired Bluetooth ELM327 adapter (optional).
const car = createCar({
  els: {
    button: $("#car-btn"),
    status: $("#car-status"),
    rpm: $("#car-rpm"),
    metric: $('[data-testid="speed"]'),
    metricLabel: $('[data-testid="speed-label"]'),
  },
});

const recorder = createRecorder({
  car,
  els: {
    toggle: $("#record-btn"),
    status: $("#record-status"),
    score: $('[data-testid="score"]'),
    jerk: $('[data-testid="jerk"]'),
    events: $('[data-testid="events"]'),
    speed: $('[data-testid="speed"]'),
  },
  onStopped: () => {
    drivesView.render();
    guard?.retry(); // an update that arrived mid-drive can apply now
  },
});

// ---- Tabs ----
let currentTab = "drive";
const tabButtons = () => [...document.querySelectorAll(".tabs button")];
function showView(name) {
  currentTab = name;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  store.set("ui.tab", name);
  if (name === "drives") drivesView.render();
}
document
  .querySelectorAll(".tabs button")
  .forEach((b) => b.addEventListener("click", () => showView(b.dataset.tab)));

// Swipe between tabs, never while recording a drive.
createSwipe({
  label: $("#swipe-label"),
  getTabs: () => tabButtons().map((b) => b.dataset.tab),
  getCurrent: () => currentTab,
  getView: (name) => $(`.view[data-view="${name}"]`),
  getTabButton: (name) => $(`.tabs button[data-tab="${name}"]`),
  labelFor: (name) => $(`.tabs button[data-tab="${name}"]`).textContent,
  onSwitch: (name) => showView(name),
  isBlocked: () => recorder.recording(),
});

drivesView
  .repair()
  .catch(() => {})
  .finally(() => showView(store.get("ui.tab", "drive")));

// ---- Export / Import ----
$("#export-btn").addEventListener("click", async () => {
  const drives = (await db.all()).filter((d) => !d.inProgress);
  const backup = buildBackup({ version: VERSION, data: { store: store.entries(), drives } });
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("#backup-status").textContent = `Exported ${drives.length} drives to ${a.download}`;
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("#backup-status");
  try {
    if (recorder.recording()) throw new Error("Stop the drive first.");
    const backup = parseBackup(await file.text());
    const drives = backup.data.drives || [];
    if (!Array.isArray(drives) || !drives.every(isValidDrive)) {
      throw new Error("The file has damaged drive data.");
    }
    if (!window.confirm("Replace all Smooth Ride data on this phone with this backup?")) return;
    store.clear();
    for (const [key, value] of Object.entries(backup.data.store || {})) store.set(key, value);
    await db.replaceAll(drives.map((d) => finalizeDrive({ ...d, inProgress: false })));
    status.textContent = `Imported ${drives.length} drives from ${String(backup.exportedAt).slice(0, 10)}`;
  } catch (err) {
    status.textContent = "Import failed: " + err.message; // textContent: never parsed as HTML
  }
});

// ---- Service worker and updates ----
async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  guard = createReloadGuard({
    hadController: Boolean(navigator.serviceWorker.controller),
    reload: () => window.location.reload(),
    getActiveElement: () => document.activeElement,
    isBusy: () => recorder.recording(),
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => guard.onControllerChange());
  document.addEventListener("focusout", () => setTimeout(() => guard.retry(), 0));

  const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  const check = () => reg.update().catch(() => {});
  check();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });

  $("#check-updates").addEventListener("click", async () => {
    const status = $("#update-status");
    status.textContent = "Checking…";
    try {
      await reg.update();
      status.textContent =
        reg.installing || reg.waiting
          ? "Update found, installing…"
          : "You have the latest version.";
    } catch {
      status.textContent = "Could not check (offline?).";
    }
  });
}
setupServiceWorker();
