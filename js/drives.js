// History tab: overall score, list of drives with their firm/harsh strip, drive details,
// GPX import and the demo drive. Built with DOM nodes and textContent only.
import { parseGpx } from "./core/gpx.js";
import { demoFixes, DEMO_NAME } from "./core/demo.js";
import { makeDrive, finalizeDrive, needsRescore, sortDrives } from "./core/drives.js";
import { fmtDistance, fmtDuration, fmtSpeed, fmtNumber, fmtDate } from "./core/format.js";
import { db } from "./db.js";
import { profileScore } from "./core/profile.js";
import { showDriveMap } from "./map.js";
import { createReadout } from "./lcd.js";

const SOURCE_LABEL = { live: "Live", gpx: "GPX", demo: "Demo" };

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

export function createDrivesView({ list, profile, importInput, demoButton, status, isRecording }) {
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

  /** Course difficulty and the three parts it's made of (see js/core/difficulty.js). */
  function courseStats(c) {
    return el("div", { class: "course-stats", "data-testid": "course-stats" }, [
      el("h3", { text: "Course difficulty" }),
      el("div", { class: "stats" }, [
        stat("Difficulty /10", fmtNumber(c.difficulty, 1)),
        stat("Bends /3.5", fmtNumber(c.bends, 1)),
        stat("Fast corners /3.5", fmtNumber(c.corners, 1)),
        stat("Speed changes /2", fmtNumber(c.speed, 1)),
        stat("Climb /1", c.climb == null ? "--" : fmtNumber(c.climb, 1)),
        stat("Turning °/km", String(c.turningPerKm)),
        stat("Cornering m/s²", fmtNumber(c.corneringLoad, 2)),
        stat("Speed swing km/h per km", String(c.swingPerKm)),
        stat("Climb m/km", c.climbPerKm == null ? "--" : fmtNumber(c.climbPerKm, 1)),
      ]),
    ]);
  }

  /** Car (OBD) numbers, when an adapter was connected during the drive. */
  function carStats(c) {
    const pct = (x) => (x == null ? "--" : `${Math.round(x)}%`);
    return el("div", { class: "car-stats", "data-testid": "car-stats" }, [
      el("h3", { text: "Car data" }),
      el("div", { class: "stats" }, [
        stat("L/100 km", fmtNumber(c.lPer100km, 1)),
        stat("Fuel used L", fmtNumber(c.litres, 2)),
        stat("Idling L", fmtNumber(c.idleLitres, 2)),
        stat("Avg rpm", c.avgRpm == null ? "--" : String(Math.round(c.avgRpm))),
        stat("Max rpm", c.maxRpm == null ? "--" : String(Math.round(c.maxRpm))),
        stat("Avg throttle", pct(c.avgThrottle)),
        stat("Max throttle", pct(c.maxThrottle)),
        stat("Cold engine", c.coldShare == null ? "--" : pct(c.coldShare * 100)),
      ]),
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
    if (s.course) wrap.appendChild(courseStats(s.course));
    if (s.car) wrap.appendChild(carStats(s.car));
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

  /** Where along the drive it went firm (amber) or harsh (red); gaps stay empty. */
  function ribbon(s) {
    const levels = Array.isArray(s.ribbon) ? s.ribbon : [];
    const cls = { "-1": "rn", 0: "r0", 1: "r1", 2: "r2" };
    return el(
      "div",
      { class: "ribbon", "aria-hidden": "true", "data-testid": "ribbon" },
      levels.map((level) => el("i", { class: cls[level] || "rn" })),
    );
  }

  /** Overall score: every real drive weighted by distance. */
  function renderProfile(drives) {
    const p = profileScore(drives);
    const scoreText = p.score == null ? "--" : String(p.score);
    const sub =
      p.score == null
        ? "Appears after your first scored drive."
        : `${fmtDistance(p.distance)} over ${p.drives} drive${p.drives === 1 ? "" : "s"}`;
    const score = createReadout(scoreText, { hot: true });
    score.digits.classList.add("profile-score");
    profile.replaceChildren(
      score.root,
      el("span", { class: "profile-main" }, [
        el("span", { class: "profile-title", text: "Your score" }),
        el("span", { class: "profile-sub", text: sub }),
        el("span", {
          class: "profile-note",
          text: "Longer drives count for more. Demo drives don't count.",
        }),
      ]),
    );
  }

  async function render() {
    const token = ++renderToken;
    const drives = sortDrives((await db.all()).filter((d) => !d.inProgress && d.summary));
    if (token !== renderToken) return;
    disposeMap();
    renderProfile(drives);
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
      const scoreText = s.score == null ? "--" : String(s.score);
      const meta = [
        fmtDistance(s.distance),
        fmtDuration(s.duration),
        `${s.harsh} harsh`,
        s.car?.lPer100km != null ? `${fmtNumber(s.car.lPer100km, 1)} L/100 km` : null,
        SOURCE_LABEL[d.source] || "Live",
      ].filter(Boolean);
      const head = el(
        "button",
        { type: "button", class: "drive-row", "aria-expanded": String(open === d.id) },
        [
          createReadout(scoreText, { hot: true, className: "drive-score" }).root,
          el("span", { class: "drive-main" }, [
            el("span", { class: "drive-title", text: d.name || fmtDate(s.startedAt) }),
            el(
              "span",
              { class: "drive-sub" },
              meta.map((text) => el("span", { text })),
            ),
          ]),
          el("span", { class: "drive-difficulty", "data-testid": "drive-difficulty" }, [
            createReadout(s.course ? fmtNumber(s.course.difficulty, 1) : "--", {
              className: "drive-difficulty-readout",
            }).root,
            el("span", { class: "drive-difficulty-label", text: "Difficulty" }),
          ]),
        ],
      );
      head.addEventListener("click", () => {
        open = open === d.id ? null : d.id;
        render();
      });
      const item = el("li", { class: "drive", "data-testid": "drive" }, [head, ribbon(s)]);
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

  // A simulated drive to try the list and the map. Opens straight away.
  demoButton.addEventListener("click", async () => {
    // Place it ten minutes ago so it sorts to the top.
    const fixes = demoFixes(Date.now() - 10 * 60 * 1000);
    const drive = finalizeDrive(makeDrive({ source: "demo", name: DEMO_NAME, fixes }));
    await db.put(drive);
    open = drive.id;
    status.textContent = "Added a simulated demo drive. Delete it any time.";
    render();
  });

  return { render, repair };
}
