/**
 * @typedef {import('./backup-scanner.js').BackupEntry} BackupEntry
 */

/**
 * Union keep: keep if in newest `keepLast` OR newer than `keepDays` cutoff.
 * @param {BackupEntry[]} sortedNewestFirst
 * @param {{ keepLast?: number, keepDays?: number, now?: number }} opts
 * @returns {{ keep: BackupEntry[], remove: BackupEntry[] }}
 */
export function planRetention(sortedNewestFirst, opts) {
  const now = opts.now ?? Date.now();
  const keepLast = opts.keepLast;
  const keepDays = opts.keepDays;
  const cutoff = keepDays != null ? now - keepDays * 86400000 : null;

  /** @type {BackupEntry[]} */
  const keep = [];
  /** @type {BackupEntry[]} */
  const remove = [];

  sortedNewestFirst.forEach((entry, index) => {
    const t = (entry.parsedDate ?? entry.mtime).getTime();
    let kept = false;
    if (keepLast != null && index < keepLast) kept = true;
    if (cutoff != null && t >= cutoff) kept = true;
    if (kept) keep.push(entry);
    else remove.push(entry);
  });

  return { keep, remove };
}
