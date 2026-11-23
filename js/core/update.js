// Decides when a new service worker may reload the page: once, never on the very first
// install, and never while the user is typing (then it waits until focus leaves).
const NON_TEXT_INPUTS = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "image",
  "hidden",
]);

export function isTyping(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(String(el.type || "text").toLowerCase());
  return el.isContentEditable === true;
}

export function createReloadGuard({ hadController, reload, getActiveElement }) {
  let done = false;
  let pending = false;
  const tryReload = () => {
    if (done) return false;
    if (isTyping(getActiveElement())) {
      pending = true;
      return false;
    }
    done = true;
    pending = false;
    reload();
    return true;
  };
  return {
    /** Call on navigator.serviceWorker "controllerchange". */
    onControllerChange() {
      if (!hadController) return false; // first install: the page is already fresh
      return tryReload();
    },
    /** Call on focusout; performs a reload that was held back while typing. */
    onTypingDone() {
      return pending ? tryReload() : false;
    },
    get pending() {
      return pending;
    },
  };
}
