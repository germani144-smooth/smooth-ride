// Small geodesy helpers (WGS84 sphere approximation, good to well under 1% at car scales).
const R = 6371008.8; // mean Earth radius, m
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distance(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in radians, 0 = north, clockwise, range (-PI, PI]. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

/** Wrap an angle difference into (-PI, PI]. */
export function wrapAngle(a) {
  let x = a;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
}
