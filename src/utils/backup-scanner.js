import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * @typedef {object} BackupEntry
 * @property {string} path
 * @property {string} filename
 * @property {number} size
 * @property {Date} mtime
 * @property {string} [database]
 * @property {Date} [parsedDate]
 * @property {boolean} compressed
 */

// dbname_YYYYMMDD_HHMMSS.sql or .sql.gz
const FILENAME_RE = /^(.+)_(\d{8})_(\d{6})(\.sql)(\.gz)?$/;

/**
 * @param {string} filename
 */
export function parseBackupFilename(filename) {
  const base = basename(filename);
  const m = base.match(FILENAME_RE);
  if (!m) {
    return { database: undefined, parsedDate: undefined };
  }
  const [, db, ymd, hms] = m;
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const hh = Number(hms.slice(0, 2));
  const mm = Number(hms.slice(2, 4));
  const ss = Number(hms.slice(4, 6));
  const parsedDate = new Date(y, mo, d, hh, mm, ss);
  return { database: db, parsedDate };
}

/**
 * @param {string} backupDir
 * @returns {BackupEntry[]}
 */
export function scanBackups(backupDir) {
  let names;
  try {
    names = readdirSync(backupDir);
  } catch {
    return [];
  }

  /** @type {BackupEntry[]} */
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.sql') && !name.endsWith('.sql.gz')) continue;
    const p = join(backupDir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const { database, parsedDate } = parseBackupFilename(name);
    out.push({
      path: p,
      filename: name,
      size: st.size,
      mtime: st.mtime,
      database,
      parsedDate,
      compressed: name.endsWith('.gz'),
    });
  }

  out.sort((a, b) => {
    const ta = (b.parsedDate ?? b.mtime).getTime();
    const tb = (a.parsedDate ?? a.mtime).getTime();
    return ta - tb;
  });

  return out;
}

/**
 * @param {BackupEntry[]} entries
 * @param {{ database?: string, limit?: number, since?: Date }} filters
 */
export function filterBackups(entries, filters = {}) {
  let list = entries;
  if (filters.database) {
    const d = filters.database.toLowerCase();
    list = list.filter((e) => (e.database || '').toLowerCase() === d);
  }
  if (filters.since) {
    const t = filters.since.getTime();
    list = list.filter((e) => (e.parsedDate ?? e.mtime).getTime() >= t);
  }
  if (filters.limit != null && filters.limit > 0) {
    list = list.slice(0, filters.limit);
  }
  return list;
}
