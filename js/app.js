// UI wiring only. Logic lives in js/core/ (pure, unit tested).
import { VERSION } from "./version.js";
import { createStore, memoryBackend } from "./core/storage.js";
import { buildBackup, backupFileName, parseBackup } from "./core/backup.js";
import { createReloadGuard } from "./core/update.js";

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

// ---- Version ----
document
  .querySelectorAll('[data-testid="version"], [data-testid="settings-version"]')
  .forEach((el) => {
    el.textContent = "v" + VERSION;
  });

// ---- Tabs ----
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  store.set("ui.tab", name);
}
document
  .querySelectorAll(".tabs button")
  .forEach((b) => b.addEventListener("click", () => showView(b.dataset.tab)));
showView(store.get("ui.tab", "drive"));

// ---- Export / Import ----
$("#export-btn").addEventListener("click", () => {
  const backup = buildBackup({ version: VERSION, data: { store: store.entries() } });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("#backup-status").textContent = "Exported " + a.download;
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("#backup-status");
  try {
    const backup = parseBackup(await file.text());
    if (!window.confirm("Replace all Smooth Ride data on this phone with this backup?")) return;
    store.clear();
    for (const [key, value] of Object.entries(backup.data.store || {})) store.set(key, value);
    status.textContent = "Imported backup from " + backup.exportedAt.slice(0, 10);
  } catch (err) {
    status.textContent = "Import failed: " + err.message; // textContent: never parsed as HTML
  }
});

// ---- Service worker and updates ----
async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const guard = createReloadGuard({
    hadController: Boolean(navigator.serviceWorker.controller),
    reload: () => window.location.reload(),
    getActiveElement: () => document.activeElement,
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => guard.onControllerChange());
  document.addEventListener("focusout", () => setTimeout(() => guard.onTypingDone(), 0));

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
