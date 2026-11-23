// Versioned Export/Import. The file format number only goes up; every older format
// gets a migration step so old exports keep importing.
import { APP } from "../version.js";

export const BACKUP_FORMAT = 1;

export function buildBackup({ version, data, now = new Date() }) {
  return {
    app: APP,
    format: BACKUP_FORMAT,
    appVersion: version,
    exportedAt: now.toISOString(),
    data,
  };
}

export function backupFileName(now = new Date()) {
  return `${APP}-export-${now.toISOString().slice(0, 10)}.json`;
}

const MIGRATIONS = {
  // 1: (backup) => ({ ...backup, format: 2, data: ... }),
};

/** Parse and validate an export. Throws an Error with a readable message. */
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (!backup || typeof backup !== "object" || backup.app !== APP) {
    throw new Error("This file is not a Smooth Ride export.");
  }
  if (!Number.isInteger(backup.format) || backup.format < 1) {
    throw new Error("Unknown export format.");
  }
  if (backup.format > BACKUP_FORMAT) {
    throw new Error("This export is from a newer version. Update the app first.");
  }
  while (backup.format < BACKUP_FORMAT) {
    const step = MIGRATIONS[backup.format];
    if (!step) throw new Error(`No migration from format ${backup.format}.`);
    backup = step(backup);
  }
  if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
    throw new Error("Export has no data.");
  }
  return backup;
}
