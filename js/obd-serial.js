// Bluetooth Classic link to an ELM327 adapter through Web Serial (Chrome on Android, with
// the adapter paired in Android's Bluetooth settings). Gives the session its send().
const SPP = "00001101-0000-1000-8000-00805f9b34fb"; // Serial Port Profile

export function serialAvailable() {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.serial) &&
    typeof navigator.serial.requestPort === "function"
  );
}

/**
 * Open the adapter. Reuses the one picked before when there is exactly one, so the chooser
 * only shows the first time. Must be called from a tap (the browser requires it).
 */
export async function openAdapter({ onClose = () => {} } = {}) {
  let port = null;
  try {
    const known = await navigator.serial.getPorts();
    if (known.length === 1) port = known[0];
  } catch {
    /* fall through to the chooser */
  }
  if (!port) {
    port = await navigator.serial.requestPort({
      filters: [{ bluetoothServiceClassId: SPP }],
      allowedBluetoothServiceClassIds: [SPP],
    });
  }
  // The baud rate is ignored over Bluetooth but the API requires one.
  await port.open({ baudRate: 38400 });

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let buffer = "";
  let waiting = null; // { resolve, reject, timer }
  let closed = false;
  let queue = Promise.resolve();

  function settle() {
    const at = buffer.indexOf(">");
    if (waiting && at >= 0) {
      const reply = buffer.slice(0, at + 1);
      buffer = buffer.slice(at + 1);
      const w = waiting;
      waiting = null;
      clearTimeout(w.timer);
      w.resolve(reply);
    }
  }

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        settle();
      }
    } catch {
      /* link lost */
    } finally {
      closed = true;
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("Adapter disconnected."));
        waiting = null;
      }
      onClose();
    }
  })();

  /** Send one command and resolve with the raw reply up to the ">" prompt. One at a time. */
  function send(command, timeout = 2000) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error("Adapter disconnected."));
          return;
        }
        buffer = ""; // drop anything late from a timed-out command
        waiting = {
          resolve,
          reject,
          timer: setTimeout(() => {
            waiting = null;
            reject(new Error(`No reply to ${command}.`));
          }, timeout),
        };
        writer.write(enc.encode(command + "\r")).catch((err) => {
          if (waiting) {
            clearTimeout(waiting.timer);
            waiting = null;
          }
          reject(err);
        });
      });
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  async function close() {
    closed = true;
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    try {
      reader.releaseLock();
      writer.releaseLock();
      await port.close();
    } catch {
      /* already closed */
    }
  }

  return { send, close };
}
