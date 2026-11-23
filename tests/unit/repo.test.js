// Guards for the repo rules: one version everywhere, a complete precache list,
// manifest identity, and a CSP that only allows our own address plus OSM tiles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../js/version.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sw = read("sw.js");

function swPrecache() {
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// App files = everything served to the phone (not tooling, tests or docs).
const APP_DIRS = ["css", "js", "icons", "vendor"];
function appFiles() {
  const out = ["index.html", "manifest.webmanifest"];
  const walk = (dir) => {
    if (!existsSync(join(ROOT, dir))) return;
    for (const name of readdirSync(join(ROOT, dir))) {
      const p = join(dir, name);
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else out.push(relative(ROOT, join(ROOT, p)).split("\\").join("/"));
    }
  };
  APP_DIRS.forEach(walk);
  return out;
}

test("version matches in version.js, sw.js and package.json", () => {
  const swVersion = sw.match(/const VERSION = "([^"]+)"/)[1];
  const pkg = JSON.parse(read("package.json"));
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(swVersion, VERSION);
  assert.equal(pkg.version, VERSION);
});

test("service worker caches under its own prefix", () => {
  assert.match(sw, /const PREFIX = "smooth-ride-";/);
  assert.match(sw, /cache: "reload"/);
});

test("precache lists every app file, and every listed file exists", () => {
  const listed = swPrecache();
  for (const p of listed) {
    if (p === "./") continue;
    assert.ok(existsSync(join(ROOT, p)), `missing precached file ${p}`);
  }
  const listedSet = new Set(listed.map((p) => p.replace(/^\.\//, "")));
  for (const f of appFiles()) assert.ok(listedSet.has(f), `app file not precached: ${f}`);
});

test("manifest identity is fixed", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.id, "/smooth-ride/");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
});

test("CSP allows only self plus the OSM tile address", () => {
  const html = read("index.html");
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const hosts = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(hosts)], ["https://tile.openstreetmap.org"]);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test("no inline scripts or inline event handlers", () => {
  const html = read("index.html");
  for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc=/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
});

test("gitignore keeps personal data and local settings out", () => {
  const gi = read(".gitignore");
  for (const rule of [".claude/settings.local.json", "*.gpx", "exports/"]) {
    assert.ok(gi.split("\n").includes(rule), `.gitignore lacks ${rule}`);
  }
});
