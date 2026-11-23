// Escape text before it goes anywhere near HTML. The UI uses textContent by default;
// this is for the rare place that has to build markup from user or fetched text.
const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => MAP[ch]);
}
