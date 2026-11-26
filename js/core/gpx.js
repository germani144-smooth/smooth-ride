// Tolerant GPX parser (pure string parsing, so it runs in tests without a DOM).
// Returns fixes in the same shape as live GPS: { t (ms), lat, lon, speed (m/s|null), accuracy (m|null) }.
import { t } from "./i18n.js";

const num = (s) => {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
};
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? num(m[1]) : null;
};
const tag = (body, name) => {
  const m = body.match(
    new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`),
  );
  return m ? m[1] : null;
};

export function parseGpx(text) {
  const src = String(text || "");
  if (!/<gpx\b/i.test(src)) throw new Error(t("error.notGpx"));

  const trk = src.match(/<trk\b[^>]*>([\s\S]*?)<\/trk>/);
  const nameSrc = trk ? trk[1].split(/<trkseg\b/)[0] : src.split(/<trk\b/)[0];
  const name = tag(nameSrc, "name");

  const fixes = [];
  const re = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    const body = m[2] || "";
    const lat = attr(attrs, "lat");
    const lon = attr(attrs, "lon");
    const timeText = tag(body, "time");
    const t = timeText ? Date.parse(timeText) : NaN;
    if (lat === null || lon === null || !Number.isFinite(t)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const speedText = tag(body, "speed");
    const speed = speedText === null ? null : num(speedText);
    const accText = tag(body, "accuracy");
    const accuracy = accText === null ? null : num(accText);
    const eleText = tag(body, "ele");
    const altitude = eleText === null ? null : num(eleText);
    fixes.push({
      t,
      lat,
      lon,
      speed: speed !== null && speed >= 0 ? speed : null,
      accuracy,
      altitude,
    });
  }
  if (fixes.length < 2) throw new Error(t("error.noPoints"));
  fixes.sort((a, b) => a.t - b.t);
  return { name: name ? decodeEntities(name) : null, fixes };
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
