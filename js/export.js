// Settings: pick which drives to export. A list of drives with checkboxes, Select all/none,
// and an Export button that says how many. Built with DOM nodes and textContent only.
import { t } from "./core/i18n.js";
import { fmtDate, fmtDistance } from "./core/format.js";
import { sortDrives } from "./core/drives.js";

export function createExportPicker({ els, loadDrives, onExport }) {
  let drives = [];
  const chosen = new Set();

  function updateButton() {
    els.exportSelected.textContent = t("backup.exportSelected", { count: chosen.size });
    els.exportSelected.disabled = chosen.size === 0;
  }

  function name(d) {
    return d.source === "demo" ? t("history.demoName") : d.name || fmtDate(d.summary.startedAt);
  }

  function renderList() {
    els.list.replaceChildren(
      ...drives.map((d) => {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = chosen.has(d.id);
        box.addEventListener("change", () => {
          if (box.checked) chosen.add(d.id);
          else chosen.delete(d.id);
          updateButton();
        });
        const title = document.createElement("span");
        title.className = "pick-title";
        title.textContent = name(d);
        const sub = document.createElement("span");
        sub.className = "pick-sub";
        const score = d.summary.score == null ? "--" : String(d.summary.score);
        sub.textContent = `${fmtDistance(d.summary.distance)}, ${score}`;
        const label = document.createElement("label");
        label.className = "pick";
        label.dataset.testid = "pick";
        const text = document.createElement("span");
        text.className = "pick-text";
        text.append(title, sub);
        label.append(box, text);
        const item = document.createElement("li");
        item.append(label);
        return item;
      }),
    );
    updateButton();
  }

  async function open() {
    drives = sortDrives((await loadDrives()).filter((d) => !d.inProgress && d.summary));
    chosen.clear();
    if (!drives.length) {
      els.status.textContent = t("backup.noDrives");
      return;
    }
    els.status.textContent = "";
    renderList();
    els.picker.hidden = false;
  }

  function close() {
    els.picker.hidden = true;
    chosen.clear();
  }

  els.choose.addEventListener("click", () => (els.picker.hidden ? open() : close()));
  els.cancel.addEventListener("click", close);
  els.all.addEventListener("click", () => {
    drives.forEach((d) => chosen.add(d.id));
    renderList();
  });
  els.none.addEventListener("click", () => {
    chosen.clear();
    renderList();
  });
  els.exportSelected.addEventListener("click", async () => {
    const picked = drives.filter((d) => chosen.has(d.id));
    if (!picked.length) return;
    await onExport(picked);
    close();
  });

  return {
    /** Texts after a language change. */
    relabel() {
      if (!els.picker.hidden) renderList();
    },
  };
}
