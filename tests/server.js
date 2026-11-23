// Tiny static server for local testing. Serves the repo under /smooth-ride/, the
// same path GitHub Pages uses, so scope and relative URLs behave like production.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASE = "/smooth-ride/";
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!path.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE }).end();
    return;
  }
  let rel = normalize(path.slice(BASE.length) || "index.html");
  if (rel.endsWith("/")) rel += "index.html";
  if (rel.startsWith("..") || /(^|\/)(node_modules|tests|\.git)(\/|$)/.test(rel)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}`));
