// IndexedDB storage for drives. Database name carries the app prefix; data stays on the phone.
const DB_NAME = "smooth-ride.db";
const STORE = "drives";
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  all: () => run("readonly", (s) => s.getAll()),
  get: (id) => run("readonly", (s) => s.get(id)),
  put: (drive) => run("readwrite", (s) => s.put(drive)),
  delete: (id) => run("readwrite", (s) => s.delete(id)),
  async replaceAll(drives) {
    return run("readwrite", (s) => {
      s.clear();
      drives.forEach((d) => s.put(d));
    });
  },
};
