// Display formatting (pure).
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

export function fmtDate(ms) {
  if (!Number.isFinite(ms)) return "--";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** CSS class for a score: good / ok / poor. */
export function scoreClass(score) {
  if (score == null) return "";
  return score >= 75 ? "good" : score >= 50 ? "ok" : "poor";
}
