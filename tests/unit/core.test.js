import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../../js/core/escape.js";
import { createStore, memoryBackend, PREFIX } from "../../js/core/storage.js";
import { buildBackup, parseBackup, backupFileName, BACKUP_FORMAT } from "../../js/core/backup.js";
import { createReloadGuard, isTyping } from "../../js/core/update.js";

test("escapeHtml escapes every HTML-significant character", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="a('b')">&`),
    "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
  );
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(42), "42");
});

test("store prefixes keys and leaves other apps' keys alone", () => {
  const backend = memoryBackend();
  backend.setItem("nap-log.x", "1");
  const store = createStore(backend);
  store.set("a", { b: 1 });
  assert.equal(backend.getItem(PREFIX + "a"), '{"b":1}');
  assert.deepEqual(store.get("a"), { b: 1 });
  assert.equal(store.get("missing", 7), 7);
  assert.deepEqual(store.entries(), { a: { b: 1 } });
  store.clear();
  assert.deepEqual(store.entries(), {});
  assert.equal(backend.getItem("nap-log.x"), "1");
});

test("store survives a corrupt value", () => {
  const backend = memoryBackend();
  backend.setItem(PREFIX + "bad", "{not json");
  assert.equal(createStore(backend).get("bad", "fb"), "fb");
});

test("backup round-trips and is versioned", () => {
  const now = new Date("2026-11-23T10:00:00Z");
  const b = buildBackup({ version: "0.1.0", data: { store: { x: 1 } }, now });
  assert.equal(b.app, "smooth-ride");
  assert.equal(b.format, BACKUP_FORMAT);
  assert.deepEqual(parseBackup(JSON.stringify(b)).data, { store: { x: 1 } });
  assert.equal(backupFileName(now), "smooth-ride-export-2026-11-23.json");
});

test("parseBackup rejects foreign, newer and broken files", () => {
  assert.throws(() => parseBackup("nope"), /valid JSON/);
  assert.throws(() => parseBackup('{"app":"lift-log","format":1,"data":{}}'), /not a Smooth Ride/);
  assert.throws(
    () => parseBackup(JSON.stringify({ app: "smooth-ride", format: BACKUP_FORMAT + 1, data: {} })),
    /newer version/,
  );
  assert.throws(() => parseBackup('{"app":"smooth-ride","format":1}'), /no data/);
});

test("isTyping only counts text entry", () => {
  assert.equal(isTyping({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTyping({ tagName: "TEXTAREA" }), true);
  assert.equal(isTyping({ tagName: "INPUT", type: "file" }), false);
  assert.equal(isTyping({ tagName: "BUTTON" }), false);
  assert.equal(isTyping(null), false);
});

test("reload guard: never on first install", () => {
  let reloads = 0;
  const g = createReloadGuard({
    hadController: false,
    reload: () => reloads++,
    getActiveElement: () => null,
  });
  g.onControllerChange();
  assert.equal(reloads, 0);
});

test("reload guard: reloads once on update", () => {
  let reloads = 0;
  const g = createReloadGuard({
    hadController: true,
    reload: () => reloads++,
    getActiveElement: () => null,
  });
  g.onControllerChange();
  g.onControllerChange();
  assert.equal(reloads, 1);
});

test("reload guard: waits while typing, then reloads once", () => {
  let reloads = 0;
  let active = { tagName: "INPUT", type: "text" };
  const g = createReloadGuard({
    hadController: true,
    reload: () => reloads++,
    getActiveElement: () => active,
  });
  g.onControllerChange();
  assert.equal(reloads, 0);
  assert.equal(g.pending, true);
  active = null;
  g.retry();
  g.retry();
  assert.equal(reloads, 1);
});

test("reload guard: waits while recording a drive", () => {
  let reloads = 0;
  let recording = true;
  const g = createReloadGuard({
    hadController: true,
    reload: () => reloads++,
    getActiveElement: () => null,
    isBusy: () => recording,
  });
  g.onControllerChange();
  g.retry();
  assert.equal(reloads, 0);
  recording = false;
  g.retry();
  assert.equal(reloads, 1);
});
