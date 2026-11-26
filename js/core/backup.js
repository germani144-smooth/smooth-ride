// Versioned Export/Import. The file format number only goes up; every older format
// gets a migration step so old exports keep importing.
import { APP } from "../version.js";
import { t } from "./i18n.js";

export const BACKUP_FORMAT = 1;

/**
 * A whole backup (all drives and settings), or with `partial` some chosen drives only:
 * importing a partial export adds its drives and leaves everything else on the phone alone.
 * The flag is optional, so format 1 stays format 1.
 */
export function buildBackup({ version, data, partial = false, now = new Date() }) {
  return {
    app: APP,
    format: BACKUP_FORMAT,
    appVersion: version,
    exportedAt: now.toISOString(),
    ...(partial ? { partial: true } : {}),
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
    throw new Error(t("error.json"));
  }
  if (!backup || typeof backup !== "object" || backup.app !== APP) {
    throw new Error(t("error.notExport"));
  }
  if (!Number.isInteger(backup.format) || backup.format < 1) {
    throw new Error(t("error.format"));
  }
  if (backup.format > BACKUP_FORMAT) {
    throw new Error(t("error.newer"));
  }
  while (backup.format < BACKUP_FORMAT) {
    const step = MIGRATIONS[backup.format];
    if (!step) throw new Error(t("error.migration", { format: backup.format }));
    backup = step(backup);
  }
  if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
    throw new Error(t("error.noData"));
  }
  return backup;
}
