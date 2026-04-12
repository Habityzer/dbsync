import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, mergeWithCli } from '../utils/config-loader.js';
import { scanBackups } from '../utils/backup-scanner.js';
import { planRetention } from '../utils/retention.js';
import { formatBytes } from '../utils/progress.js';
import { BackupError } from '../utils/errors.js';
import * as ui from '../utils/ui.js';

/**
 * @param {object} globalOpts
 * @param {object} cmdOpts
 */
export async function runClean(globalOpts, cmdOpts) {
  const { config } = loadConfig({ configPath: globalOpts.config });
  const merged = mergeWithCli(config, {});
  const backupDir = resolve(process.cwd(), merged.backupDir || './backups');

  const entries = scanBackups(backupDir);
  if (entries.length === 0) {
    throw new BackupError('📭 No backups found', 'Run dbsync export first');
  }

  let keepLast =
    cmdOpts.keepLast !== undefined && cmdOpts.keepLast !== null
      ? Number(cmdOpts.keepLast)
      : undefined;
  let keepDays =
    cmdOpts.keepDays !== undefined && cmdOpts.keepDays !== null
      ? Number(cmdOpts.keepDays)
      : undefined;

  if (keepLast === undefined && keepDays === undefined) {
    keepLast = merged.keepLast ?? 30;
  }

  const { remove } = planRetention(entries, {
    keepLast: keepLast !== undefined && Number.isFinite(keepLast) ? keepLast : undefined,
    keepDays: keepDays !== undefined && Number.isFinite(keepDays) ? keepDays : undefined,
  });

  if (remove.length === 0) {
    ui.success('Nothing to clean');
    return;
  }

  ui.infoLine(`${cmdOpts.dryRun ? ui.icons.warn : ui.icons.pkg} ${remove.length} backup(s) eligible for removal:\n`);
  let freed = 0;
  for (const e of remove) {
    freed += e.size;
    ui.infoLine(`   ${e.filename} (${formatBytes(e.size)})`);
  }
  ui.infoLine(`\nTotal freed: ${formatBytes(freed)}`);

  if (cmdOpts.dryRun) {
    ui.infoLine(`\n${ui.icons.warn} Dry-run: no files deleted`);
    return;
  }

  for (const e of remove) {
    try {
      unlinkSync(e.path);
    } catch (err) {
      ui.warnLine(`Could not delete ${e.path}: ${err instanceof Error ? err.message : err}`);
    }
  }
  ui.success('Clean complete');
}
