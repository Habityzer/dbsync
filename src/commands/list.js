import { resolve } from 'node:path';
import { loadConfig, mergeWithCli } from '../utils/config-loader.js';
import { scanBackups, filterBackups } from '../utils/backup-scanner.js';
import { formatBytes } from '../utils/progress.js';
import { BackupError } from '../utils/errors.js';
import * as ui from '../utils/ui.js';

/**
 * @param {string[]} widths
 * @param {string[]} cells
 */
function row(widths, cells) {
  const parts = cells.map((c, i) => String(c).padEnd(widths[i]));
  return `│ ${parts.join(' │ ')} │`;
}

/**
 * @param {object} globalOpts
 * @param {object} cmdOpts
 */
export async function runList(globalOpts, cmdOpts) {
  const { config } = loadConfig({ configPath: globalOpts.config });
  const merged = mergeWithCli(config, {});
  const backupDir = resolve(process.cwd(), merged.backupDir || './backups');

  let entries = scanBackups(backupDir);
  let since =
    cmdOpts.since != null && cmdOpts.since !== ''
      ? new Date(String(cmdOpts.since).includes('T') ? cmdOpts.since : `${cmdOpts.since}T00:00:00`)
      : undefined;
  if (since && Number.isNaN(since.getTime())) {
    ui.warnLine(`Ignoring invalid --since date: ${cmdOpts.since}`);
    since = undefined;
  }
  entries = filterBackups(entries, {
    database: cmdOpts.database,
    limit: cmdOpts.limit,
    since,
  });

  if (entries.length === 0) {
    throw new BackupError('📭 No backups found', 'Run dbsync export first');
  }

  ui.infoLine(`${ui.icons.pkg} Available backups:\n`);

  const widths = [3, 28, 10, 12, 12];
  const sep = `├${widths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  console.log(`┌${widths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`);
  console.log(row(widths, ['#', 'File', 'Size', 'Date', 'Database']));
  console.log(sep);

  let totalBytes = 0;
  entries.forEach((e, i) => {
    totalBytes += e.size;
    const when = (e.parsedDate ?? e.mtime).toISOString().slice(0, 10);
    const name = e.filename.length > 26 ? `${e.filename.slice(0, 23)}...` : e.filename;
    console.log(row(widths, [String(i + 1), name, formatBytes(e.size), when, e.database ?? '—']));
  });

  console.log(`└${widths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`);
  ui.infoLine(`\nTotal: ${entries.length} backups | ${formatBytes(totalBytes)}`);
}
