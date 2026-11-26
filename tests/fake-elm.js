// A simulated ELM327 clone for tests (unit and browser). Answers like a cheap v1.5 clone:
// echo on until ATE0, "SEARCHING..." on the first request, "NO DATA" for PIDs the car lacks.
// Self-contained (no imports) so the browser tests can inject it with addInitScript.
export function createFakeElm({ car = {}, supported = null, noCar = false } = {}) {
  // Default car: petrol with MAF, no fuel-rate PID (typical).
  const state = { echo: true, searched: false, spaces: true };
  const sup = supported || ["04", "05", "0C", "0D", "10", "11", "20"];
  const values = {
    speed: 50,
    rpm: 1800,
    maf: 6.2,
    throttle: 18,
    pedal: 15,
    load: 35,
    coolant: 88,
    ...car,
  };

  const hex = (n, bytes = 1) =>
    Math.round(n)
      .toString(16)
      .toUpperCase()
      .padStart(bytes * 2, "0");
  const fmt = (s) => (state.spaces ? s.match(/.{2}/g).join(" ") : s);

  function bitmask(base) {
    let bits = 0n;
    for (const p of sup) {
      const n = parseInt(p, 16) - base;
      if (n >= 1 && n <= 32) bits |= 1n << BigInt(32 - n);
    }
    return bits.toString(16).toUpperCase().padStart(8, "0");
  }

  function data(pid) {
    const v = typeof values === "function" ? values() : values;
    switch (pid) {
      case "00":
      case "20":
      case "40":
        return bitmask(parseInt(pid, 16));
      case "04":
        return hex((v.load * 255) / 100);
      case "05":
        return hex(v.coolant + 40);
      case "0C":
        return hex(v.rpm * 4, 2);
      case "0D":
        return hex(v.speed);
      case "10":
        return hex(v.maf * 100, 2);
      case "11":
        return hex((v.throttle * 255) / 100);
      case "49":
        return hex((v.pedal * 255) / 100);
      case "5E":
        return hex(v.fuelRate * 20, 2);
      default:
        return null;
    }
  }

  /** The raw text the adapter sends back for one command, prompt included. */
  function respond(command) {
    const c = command.replace(/\s/g, "").toUpperCase();
    const echo = state.echo ? command + "\r" : "";
    let body;
    if (c === "ATZ") {
      state.echo = true;
      state.spaces = true;
      state.searched = false;
      body = "\r\rELM327 v1.5";
    } else if (c === "ATE0") {
      state.echo = false;
      body = "OK";
    } else if (c === "ATS0") {
      state.spaces = false;
      body = "OK";
    } else if (c.startsWith("AT")) {
      body = "OK";
    } else if (/^01[0-9A-F]{2}$/.test(c)) {
      const pid = c.slice(2);
      if (noCar) {
        body = (state.searched ? "" : "SEARCHING...\r") + "UNABLE TO CONNECT";
      } else {
        const d =
          pid === "00" || pid === "20" || pid === "40" || sup.includes(pid) ? data(pid) : null;
        body = (state.searched ? "" : "SEARCHING...\r") + (d ? fmt("41" + pid + d) : "NO DATA");
        state.searched = true;
      }
    } else {
      body = "?";
    }
    return echo + body + "\r\r>";
  }

  /** Change what the car reports from now on (e.g. press the pedal). */
  function set(changes) {
    Object.assign(values, changes);
  }

  return { respond, values, state, set };
}
