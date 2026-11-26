// Languages: English (default), Danish and Brazilian Portuguese. Pure: dictionaries plus a
// current language; the page applies it (js/i18n.js). Every key in English must exist in
// every other language with the same {placeholders} (a unit test checks).
import en from "./lang/en.js";
import da from "./lang/da.js";
import ptBR from "./lang/pt-BR.js";

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "da", name: "Dansk" },
  { code: "pt-BR", name: "Português (Brasil)" },
];
export const DEFAULT_LANGUAGE = "en";

const DICTIONARIES = { en, da, "pt-BR": ptBR };

let current = DEFAULT_LANGUAGE;

/** A known language code, or the default (English) for anything else. */
export function pickLanguage(code) {
  return Object.hasOwn(DICTIONARIES, code) ? code : DEFAULT_LANGUAGE;
}

export function setLanguage(code) {
  current = pickLanguage(code);
  return current;
}

export function getLanguage() {
  return current;
}

export function dictionary(code) {
  return DICTIONARIES[pickLanguage(code)];
}

/**
 * The text for `key` in the current language, with {name} placeholders filled from
 * `params`. Plural entries are { one, other } and pick by params.count. Falls back to
 * English, then to the key itself.
 */
export function t(key, params = {}) {
  let entry = DICTIONARIES[current][key] ?? en[key] ?? key;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    entry = params.count === 1 ? entry.one : entry.other;
  }
  if (typeof entry !== "string") return entry;
  return entry.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** The {placeholders} a text uses (for the dictionary test). */
export function placeholders(entry) {
  const texts =
    typeof entry === "string"
      ? [entry]
      : Array.isArray(entry)
        ? []
        : Object.values(entry ?? {}).filter((v) => typeof v === "string");
  return [
    ...new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))),
  ].sort();
}
