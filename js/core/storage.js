// Prefixed key/value storage. Every key this app owns starts with PREFIX, so it never
// touches another app's data, and Export/Import can find exactly what is ours.
export const PREFIX = "smooth-ride.";

export function createStore(backend) {
  const full = (key) => PREFIX + key;
  return {
    get(key, fallback = null) {
      try {
        const raw = backend.getItem(full(key));
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        backend.setItem(full(key), JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        backend.removeItem(full(key));
      } catch {
        /* storage unavailable */
      }
    },
    /** All of our keys (without the prefix) and their parsed values. */
    entries() {
      const out = {};
      try {
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && k.startsWith(PREFIX)) {
            try {
              out[k.slice(PREFIX.length)] = JSON.parse(backend.getItem(k));
            } catch {
              /* skip unreadable value */
            }
          }
        }
      } catch {
        /* storage unavailable */
      }
      return out;
    },
    /** Remove all of our keys, leaving everything else alone. */
    clear() {
      try {
        const mine = [];
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && k.startsWith(PREFIX)) mine.push(k);
        }
        mine.forEach((k) => backend.removeItem(k));
      } catch {
        /* storage unavailable */
      }
    },
  };
}

/** In-memory backend with the localStorage interface (tests, private mode fallback). */
export function memoryBackend() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
