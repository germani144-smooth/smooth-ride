// Display formatting (pure).
import { t } from "./i18n.js";
export function fmtDistance(m) {
  if (m == null || !Number.isFinite(m)) return "--";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return "--";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtSpeed(ms) {
  return ms == null || !Number.isFinite(ms) ? "--" : String(Math.round(ms * 3.6));
}

export function fmtNumber(x, digits = 1) {
  return x == null || !Number.isFinite(x) ? "--" : x.toFixed(digits);
}

/**
 * A drive's date and time, e.g. "Mon 24 Nov, 08:28" (with the year when it isn't this year).
 * Day and month names come from the current language.
 */
export function fmtDate(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return "--";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${t("days")[d.getDay()]} ${d.getDate()} ${t("months")[d.getMonth()]}${year}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
