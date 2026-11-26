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
import { buildArch, buildBar } from "./lcd.js";
import { LANGUAGES, setLanguage, getLanguage, t } from "./core/i18n.js";
import { applyTranslations } from "./i18n.js";
import { renderAbout } from "./about.js";
import { createExportPicker } from "./export.js";

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

// ---- Language (English by default), before anything writes text ----
setLanguage(store.get("language", "en"));
applyTranslations();

// ---- Version ----
$('[data-testid="version"]').textContent = VERSION;

// ---- The display: the arched bar graph and the flat bar (split screen) ----
buildArch($("#arch"));
buildBar($("#sbar"));

// ---- History and recording ----
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
    live: $('[data-testid="live"]'),
    throttle: $('[data-testid="throttle"]'),
    throttleBar: $("#throttle-bar"),
    throttleValue: $('[data-testid="throttle-value"]'),
    metric: $('[data-testid="jerk"]'),
    metricLabel: $('[data-testid="jerk-label"]'),
  },
});

const recorder = createRecorder({
  car,
  els: {
    toggle: $("#record-btn"),
    status: $("#record-status"),
    score: $('[data-testid="score"]'),
    trip: $('[data-testid="trip"]'),
    difficulty: $('[data-testid="difficulty"]'),
    jerk: $('[data-testid="jerk"]'),
    events: $('[data-testid="events"]'),
    speed: $('[data-testid="speed"]'),
    timer: $("#rec-timer"),
    arch: $("#arch"),
    bar: $("#sbar"),
  },
  onStopped: () => {
    drivesView.render();
    guard?.retry(); // an update that arrived mid-drive can apply now
  },
});

// ---- Tabs (Drive, History) and Settings (the cog) ----
let currentTab = "drive";
let lastTab = "drive"; // where the cog returns to
const tabButtons = () => [...document.querySelectorAll(".tabs button")];
const VIEWS = ["drive", "history", "settings"];
function showView(requested) {
  // "drives" was the History tab's name before 1.0.
  const name = requested === "drives" ? "history" : VIEWS.includes(requested) ? requested : "drive";
  currentTab = name;
  if (name !== "settings") lastTab = name;
  const cog = $("#settings-btn");
  if (name === "settings") cog.setAttribute("aria-current", "page");
  else cog.removeAttribute("aria-current");
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  store.set("ui.tab", name);
  if (name === "history") drivesView.render();
}
$("#settings-btn").addEventListener("click", () =>
  showView(currentTab === "settings" ? lastTab : "settings"),
);
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

// ---- Settings: language and About ----
const languageSelect = $("#language");
for (const { code, name } of LANGUAGES) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = name;
  languageSelect.append(option);
}
languageSelect.value = getLanguage();
renderAbout($("#about-body"));
languageSelect.addEventListener("change", () => {
  store.set("language", setLanguage(languageSelect.value));
  applyTranslations();
  renderAbout($("#about-body"));
  car.relabel();
  recorder.relabel();
  picker.relabel();
  drivesView.render();
});

drivesView
  .repair()
  .catch(() => {})
  .finally(() => showView(store.get("ui.tab", "drive")));

// ---- Export (all, or chosen drives) / Import ----
function download(backup, count) {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("#backup-status").textContent = t("backup.exported", { count, file: a.download });
}

$("#export-btn").addEventListener("click", async () => {
  const drives = (await db.all()).filter((d) => !d.inProgress);
  download(
    buildBackup({ version: VERSION, data: { store: store.entries(), drives } }),
    drives.length,
  );
});

const picker = createExportPicker({
  els: {
    choose: $("#choose-btn"),
    picker: $("#export-picker"),
    list: $("#pick-list"),
    all: $("#pick-all"),
    none: $("#pick-none"),
    exportSelected: $("#export-selected"),
    cancel: $("#pick-cancel"),
    status: $("#backup-status"),
  },
  loadDrives: () => db.all(),
  onExport: async (drives) =>
    download(buildBackup({ version: VERSION, data: { drives }, partial: true }), drives.length),
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("#backup-status");
  try {
    if (recorder.recording()) throw new Error(t("backup.stopFirst"));
    const backup = parseBackup(await file.text());
    const drives = backup.data.drives || [];
    if (!Array.isArray(drives) || !drives.every(isValidDrive)) {
      throw new Error(t("backup.damaged"));
    }
    const count = drives.length;
    const date = String(backup.exportedAt).slice(0, 10);
    const finished = drives.map((d) => finalizeDrive({ ...d, inProgress: false }));
    if (backup.partial) {
      // Chosen drives only: add them (same drive again replaces itself), keep the rest.
      if (!window.confirm(t("backup.confirmAdd", { count }))) return;
      for (const drive of finished) await db.put(drive);
      status.textContent = t("backup.added", { count, date });
    } else {
      if (!window.confirm(t("backup.confirmReplace"))) return;
      store.clear();
      for (const [key, value] of Object.entries(backup.data.store || {})) store.set(key, value);
      await db.replaceAll(finished);
      // The backup's language comes with it.
      setLanguage(store.get("language", "en"));
      store.set("language", getLanguage());
      languageSelect.value = getLanguage();
      applyTranslations();
      renderAbout($("#about-body"));
      car.relabel();
      recorder.relabel();
      status.textContent = t("backup.imported", { count, date });
    }
    drivesView.render();
  } catch (err) {
    status.textContent = t("backup.failed", { message: err.message }); // textContent only
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
    status.textContent = t("settings.checking");
    try {
      await reg.update();
      status.textContent =
        reg.installing || reg.waiting ? t("settings.updateFound") : t("settings.latest");
    } catch {
      status.textContent = t("settings.offline");
    }
  });
}
setupServiceWorker();
