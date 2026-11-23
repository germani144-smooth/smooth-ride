// Drives tab: list, detail, delete, GPX import. Built with DOM nodes and textContent only.
import { parseGpx } from "./core/gpx.js";
import { makeDrive, finalizeDrive, needsRescore, sortDrives } from "./core/drives.js";
import {
  fmtDistance,
  fmtDuration,
  fmtSpeed,
  fmtNumber,
  fmtDate,
  scoreClass,
} from "./core/format.js";
import { db } from "./db.js";
import { showDriveMap } from "./map.js";

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  children.forEach((c) => node.appendChild(c));
  return node;
};

export function createDrivesView({ list, importInput, status, isRecording }) {
  let open = null; // id of the expanded drive
  let map = null; // Leaflet map of the expanded drive
  let renderToken = 0;

  function disposeMap() {
    try {
      map?.remove();
    } catch {
      /* already gone */
    }
    map = null;
  }

  /** The map card: route coloured by smoothness, with a legend. Pans with the finger. */
  function mapCard(d, token) {
    const box = el("div", { class: "drive-map", "data-noswipe": "", "data-testid": "drive-map" });
    const legend = el("div", { class: "map-legend" }, [
      el("span", { class: "key key-smooth", text: "Smooth" }),
      el("span", { class: "key key-firm", text: "Firm" }),
      el("span", { class: "key key-harsh", text: "Harsh" }),
      el("span", { class: "key key-event", text: "Harsh event" }),
    ]);
    const note = el("p", { class: "status" });
    // Draw once the box is in the page, so Leaflet can measure it.
    requestAnimationFrame(async () => {
      if (token !== renderToken) return;
      try {
        const m = await showDriveMap(box, d);
        if (token !== renderToken) m?.remove();
        else map = m;
      } catch (err) {
        note.textContent = err.message;
      }
    });
    return el("div", { class: "drive-map-wrap" }, [box, legend, note]);
  }

  /** Finish drives left in progress by a crash or reload, and re-score old ones. */
  async function repair() {
    const all = await db.all();
    for (const d of all) {
      if ((d.inProgress && !isRecording()) || needsRescore(d)) {
        const fixed = finalizeDrive(d);
        if (fixed.fixes.length < 2) await db.delete(d.id);
        else await db.put(fixed);
      }
    }
  }

  function stat(label, value) {
    return el("div", { class: "stat" }, [
      el("span", { class: "stat-value", text: value }),
      el("span", { class: "stat-label", text: label }),
    ]);
  }

  function detail(d, token) {
    const s = d.summary;
    const wrap = el("div", { class: "drive-detail", "data-testid": "drive-detail" }, [
      mapCard(d, token),
      el("div", { class: "stats" }, [
        stat("Distance", fmtDistance(s.distance)),
        stat("Time", fmtDuration(s.duration)),
        stat("Avg km/h", fmtSpeed(s.avgSpeed)),
        stat("Max km/h", fmtSpeed(s.maxSpeed)),
        stat("RMS jerk m/s³", fmtNumber(s.rmsJerk, 2)),
        stat("RMS accel m/s²", fmtNumber(s.rmsAccel, 2)),
        stat("Harsh brakes", String(s.events.brake)),
        stat("Harsh accels", String(s.events.accel)),
        stat("Sharp corners", String(s.events.lateral)),
        stat("Harsh /10 km", fmtNumber(s.harshPer10km, 1)),
        // brakeLossPerKm is J/kg per km, which is the same as kJ per tonne per km.
        stat("Braking kJ/t per km", fmtNumber(s.brakeLossPerKm, 0)),
        stat("Stops /km", fmtNumber(s.stopsPerKm, 2)),
      ]),
    ]);
    const del = el("button", { type: "button", class: "danger", text: "Delete drive" });
    del.addEventListener("click", async () => {
      if (!window.confirm("Delete this drive?")) return;
      await db.delete(d.id);
      open = null;
      render();
    });
    wrap.appendChild(del);
    return wrap;
  }

  async function render() {
    const token = ++renderToken;
    const drives = sortDrives((await db.all()).filter((d) => !d.inProgress && d.summary));
    if (token !== renderToken) return;
    disposeMap();
    list.replaceChildren();
    if (!drives.length) {
      list.appendChild(
        el("p", {
          class: "hint",
          text: "No drives yet. Record one on the Drive tab, or import a GPX file.",
        }),
      );
      return;
    }
    for (const d of drives) {
      const s = d.summary;
      const scoreText = s.score == null ? "–" : String(s.score);
      const head = el(
        "button",
        { type: "button", class: "drive-row", "aria-expanded": String(open === d.id) },
        [
          el("span", { class: "drive-score " + scoreClass(s.score), text: scoreText }),
          el("span", { class: "drive-main" }, [
            el("span", { class: "drive-title", text: d.name || fmtDate(s.startedAt) }),
            el("span", {
              class: "drive-sub",
              text: `${fmtDistance(s.distance)} · ${fmtDuration(s.duration)} · ${s.harsh} harsh · ${d.source === "gpx" ? "GPX" : "Live"}`,
            }),
          ]),
        ],
      );
      head.addEventListener("click", () => {
        open = open === d.id ? null : d.id;
        render();
      });
      const item = el("li", { class: "drive", "data-testid": "drive" }, [head]);
      if (open === d.id) item.appendChild(detail(d, token));
      list.appendChild(item);
      if (open === d.id) requestAnimationFrame(() => item.scrollIntoView({ block: "nearest" }));
    }
  }

  importInput.addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    let ok = 0;
    const errors = [];
    for (const file of files) {
      try {
        const { name, fixes } = parseGpx(await file.text());
        const drive = finalizeDrive(
          makeDrive({ source: "gpx", name: name || file.name.replace(/\.gpx$/i, ""), fixes }),
        );
        await db.put(drive);
        ok++;
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    status.textContent = [ok ? `Imported ${ok} drive${ok === 1 ? "" : "s"}.` : "", ...errors]
      .filter(Boolean)
      .join(" ");
    render();
  });

  return { render, repair };
}
