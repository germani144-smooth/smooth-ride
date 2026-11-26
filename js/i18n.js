// Puts the current language on the page: every element with data-i18n="key" gets that text,
// data-i18n-aria="key" sets aria-label. Text built in scripts uses t() from js/core/i18n.js.
import { t, getLanguage } from "./core/i18n.js";

export function applyTranslations(root = document) {
  document.documentElement.lang = getLanguage();
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll("[data-i18n-aria]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  }
}
