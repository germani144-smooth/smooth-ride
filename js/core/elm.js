// ELM327 OBD-II protocol, pure: no Bluetooth here. A transport is injected with one method,
// send(command, timeoutMs) → Promise<string> (the raw text up to the ">" prompt), so the whole
// session runs in tests against a simulated adapter.

// Petrol: stoichiometric air/fuel ratio and density, for fuel from mass air flow.
export const PETROL = { afr: 14.7, density: 740 }; // g/L

// Init sequence. ATZ resets; the rest turn off echo, linefeeds, spaces and headers, and let
// the adapter find the car's protocol. ATAT1 = adaptive timing (faster replies on clones).
export const INIT = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0"];

// Mode 01 PIDs we read, with decoders (A, B = first and second data byte).
export const PIDS = {
  "04": { key: "load", decode: ([a]) => (a * 100) / 255 }, // %
  "05": { key: "coolant", decode: ([a]) => a - 40 }, // °C
  "0C": { key: "rpm", decode: ([a, b]) => (a * 256 + b) / 4 },
  "0D": { key: "speed", decode: ([a]) => a }, // km/h
  10: { key: "maf", decode: ([a, b]) => (a * 256 + b) / 100 }, // g/s
  11: { key: "throttle", decode: ([a]) => (a * 100) / 255 }, // %
  49: { key: "pedal", decode: ([a]) => (a * 100) / 255 }, // % accelerator pedal (D)
  "5E": { key: "fuelRate", decode: ([a, b]) => (a * 256 + b) / 20 }, // L/h
};

// One stored row per poll cycle (compact, like GPS fixes). "pedal" was added in 1.4; older
// rows have one element less and read it as null.
export const ROW = ["t", "speed", "rpm", "maf", "throttle", "load", "coolant", "fuelRate", "pedal"];
export const ROW_LENGTH_BEFORE_PEDAL = 8;

const ERRORS = [
  "NO DATA",
  "UNABLE TO CONNECT",
  "CAN ERROR",
  "BUS ERROR",
  "BUS INIT: ...ERROR",
  "STOPPED",
  "ERROR",
  "?",
];

/**
 * Clean an adapter reply: drop the ">" prompt, echoed command, "SEARCHING...", "BUS INIT"
 * and blank lines. Returns { lines, error } where error is the first error text found.
 */
export function cleanReply(raw, command = "") {
  const cmd = command.replace(/\s/g, "").toUpperCase();
  const lines = String(raw)
    .replace(/>/g, "")
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.replace(/\s/g, "").toUpperCase() !== cmd)
    .filter((l) => !/^SEARCHING/i.test(l) && !/^BUS INIT:?\s*\.*\s*(OK)?$/i.test(l));
  const error = lines.find((l) => ERRORS.some((e) => l.toUpperCase().startsWith(e))) || null;
  return { lines: error ? [] : lines, error };
}

/** Data bytes of a mode 01 reply for `pid` ("0C"), or null. Takes the first ECU that answers. */
export function pidBytes(raw, pid) {
  const { lines } = cleanReply(raw, "01" + pid);
  const want = ("41" + pid).toUpperCase();
  for (const line of lines) {
    const hex = line.replace(/\s/g, "").toUpperCase();
    // With headers on, CAN replies carry a header first; find the 41xx marker.
    const at = hex.indexOf(want);
    if (at < 0 || !/^[0-9A-F]+$/.test(hex)) continue;
    const data = hex.slice(at + want.length);
    const bytes = [];
    for (let i = 0; i + 1 < data.length; i += 2) bytes.push(parseInt(data.slice(i, i + 2), 16));
    if (bytes.length) return bytes;
  }
  return null;
}

/** Decode a PID reply to a number, or null if the car didn't answer. */
export function decodePid(pid, raw) {
  const spec = PIDS[pid];
  const bytes = pidBytes(raw, pid);
  if (!spec || !bytes) return null;
  const v = spec.decode(bytes);
  return Number.isFinite(v) ? v : null;
}

/**
 * Supported PIDs from a "0100" / "0120" / "0140" reply: a set of hex PID strings like "0C".
 * `base` is the request PID (0x00, 0x20, 0x40).
 */
export function parseSupported(raw, base) {
  const b = pidBytes(raw, base.toString(16).padStart(2, "0").toUpperCase());
  const out = new Set();
  if (!b || b.length < 4) return out;
  for (let i = 0; i < 32; i++) {
    if (b[i >> 3] & (0x80 >> (i & 7))) {
      out.add((base + i + 1).toString(16).padStart(2, "0").toUpperCase());
    }
  }
  return out;
}

/** Fuel rate in L/h: the car's own fuel-rate PID if it has one, else from air flow (petrol). */
export function fuelRateLh({ fuelRate, maf }) {
  if (fuelRate != null) return fuelRate;
  if (maf == null) return null;
  return (maf * 3600) / (PETROL.afr * PETROL.density);
}

/**
 * An ELM327 session over `transport`. init() resets the adapter, connects to the car and
 * finds which PIDs it supports; poll() reads one cycle and returns a row (see ROW).
 */
export function createElmSession(transport, { now = () => Date.now() } = {}) {
  let supported = new Set();
  let cycle = 0;
  let version = null;

  async function cmd(c, timeout = 2000) {
    return transport.send(c, timeout);
  }

  async function init() {
    const reset = await cmd("ATZ", 4000);
    version = (reset.match(/ELM327\s*v?[\d.]+/i) || [null])[0];
    for (const c of INIT.slice(1)) {
      const { error } = cleanReply(await cmd(c), c);
      if (error === "?") throw new Error(`Adapter refused ${c}.`);
    }
    // The first request makes the adapter search for the protocol: allow it time.
    const first = await cmd("0100", 15000);
    const { error } = cleanReply(first, "0100");
    if (error) {
      throw new Error(
        error.startsWith("UNABLE") || error.startsWith("NO DATA")
          ? "The car didn't answer. Is the ignition on?"
          : `The car didn't answer (${error}).`,
      );
    }
    supported = parseSupported(first, 0x00);
    if (supported.has("20")) {
      for (const p of parseSupported(await cmd("0120"), 0x20)) supported.add(p);
    }
    if (supported.has("40")) {
      for (const p of parseSupported(await cmd("0140"), 0x40)) supported.add(p);
    }
    return { version, supported: [...supported].sort() };
  }

  /**
   * The PIDs read every cycle, and the slow ones (every 10th cycle). The live throttle bar
   * reads the accelerator pedal (49) when the car has it, else the throttle valve (11); engine
   * load is slow, so each cycle stays short and the bar quick.
   */
  function plan() {
    const input = supported.has("49") ? "49" : "11";
    const fast = ["0D", "0C", input].filter((p) => supported.has(p));
    if (supported.has("5E")) fast.push("5E");
    else if (supported.has("10")) fast.push("10");
    const slow = ["05", "04"].filter((p) => supported.has(p));
    return { fast, slow };
  }

  async function read(pid) {
    try {
      return decodePid(pid, await cmd("01" + pid, 1500));
    } catch {
      return null; // one missed reply shouldn't end the drive
    }
  }

  let lastCoolant = null;
  let lastLoad = null;
  async function poll() {
    const { fast, slow } = plan();
    const v = {};
    for (const pid of fast) v[PIDS[pid].key] = await read(pid);
    if (cycle % 10 === 0) {
      if (slow.includes("05")) lastCoolant = await read("05");
      if (slow.includes("04")) lastLoad = await read("04");
    }
    cycle++;
    const row = {
      t: now(),
      speed: v.speed ?? null,
      rpm: v.rpm ?? null,
      maf: v.maf ?? null,
      throttle: v.throttle ?? null,
      load: lastLoad,
      coolant: lastCoolant,
      fuelRate: fuelRateLh({ fuelRate: v.fuelRate ?? null, maf: v.maf ?? null }),
      pedal: v.pedal ?? null,
    };
    return row;
  }

  return {
    init,
    poll,
    plan,
    get supported() {
      return supported;
    },
    /** Whether the throttle bar has anything to show (pedal or throttle valve). */
    get hasThrottle() {
      return supported.has("49") || supported.has("11");
    },
    /** Whether this car can give fuel use at all. */
    get hasFuel() {
      return supported.has("5E") || supported.has("10");
    },
  };
}
