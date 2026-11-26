import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  t,
  setLanguage,
  pickLanguage,
  dictionary,
  placeholders,
} from "../../js/core/i18n.js";

afterEach(() => setLanguage(DEFAULT_LANGUAGE));

const en = dictionary("en");

for (const { code } of LANGUAGES.filter((l) => l.code !== "en")) {
  test(`${code} has every English text, with the same placeholders`, () => {
    const other = dictionary(code);
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      const a = en[key];
      const b = other[key];
      assert.equal(typeof b, typeof a, key);
      assert.equal(Array.isArray(b), Array.isArray(a), key);
      if (Array.isArray(a)) {
        assert.equal(b.length, a.length, `${key} length`);
        a.forEach((item, i) => {
          if (typeof item === "object") {
            assert.deepEqual(Object.keys(b[i]).sort(), Object.keys(item).sort(), `${key}[${i}]`);
            for (const field of Object.keys(item)) {
              assert.ok(b[i][field].length > 0, `${key}[${i}].${field}`);
            }
          }
        });
        continue;
      }
      if (typeof a === "object") assert.deepEqual(Object.keys(b).sort(), ["one", "other"], key);
      assert.deepEqual(placeholders(b), placeholders(a), key);
      assert.notEqual(String(b).trim(), "", key);
    }
  });
}

test("English is the default; unknown languages fall back to it", () => {
  assert.equal(DEFAULT_LANGUAGE, "en");
  assert.equal(pickLanguage("da"), "da");
  assert.equal(pickLanguage("pt-BR"), "pt-BR");
  assert.equal(pickLanguage("pt"), "en");
  assert.equal(pickLanguage(undefined), "en");
  assert.equal(pickLanguage("__proto__"), "en");
  assert.equal(setLanguage("xx"), "en");
});

test("t fills placeholders, picks plurals and switches language", () => {
  assert.equal(t("live.saved", { score: 91 }), "Saved. Score 91.");
  assert.equal(t("history.imported", { count: 1 }), "Imported 1 drive.");
  assert.equal(t("history.imported", { count: 3 }), "Imported 3 drives.");
  setLanguage("da");
  assert.equal(t("live.start"), "Start tur");
  assert.equal(t("history.imported", { count: 2 }), "Importerede 2 ture.");
  setLanguage("pt-BR");
  assert.equal(t("live.start"), "Iniciar viagem");
  assert.equal(t("days")[1], "seg");
  // Unknown keys show the key, so a missing text is easy to spot.
  assert.equal(t("no.such.key"), "no.such.key");
});

test("every data-i18n key in the page exists", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const keys = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20, `found ${keys.length}`);
  for (const key of keys) assert.ok(Object.hasOwn(en, key), key);
});

test("every t() key used in the scripts exists", () => {
  const files = [
    "app.js",
    "live.js",
    "car.js",
    "drives.js",
    "map.js",
    "export.js",
    "about.js",
    "core/backup.js",
    "core/gpx.js",
    "core/format.js",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../../js/${file}`, import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/\bt\("([^"]+)"/g)) {
      assert.ok(Object.hasOwn(en, key), `${file}: ${key}`);
    }
  }
});
