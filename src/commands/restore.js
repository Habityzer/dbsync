import { createReadStream, statSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { loadEnvFile } from '../utils/env-loader.js';
import { loadConfig, mergeWithCli } from '../utils/config-loader.js';
import { parseDatabaseUrl } from '../utils/url-parser.js';
import { createDecompressStream } from '../utils/compression.js';
import { createFileProgressBar, formatBytes } from '../utils/progress.js';
import { validateBackupFile } from '../utils/backup-validate.js';
import { scanBackups, filterBackups } from '../utils/backup-scanner.js';
import { AppError, BackupError } from '../utils/errors.js';
import * as ui from '../utils/ui.js';
import { confirm, ask } from '../utils/prompt.js';
import { spawnPsqlRestore, dropPostgresDatabase } from '../adapters/postgres.js';
import { spawnMysqlRestore, dropMysqlDatabase } from '../adapters/mysql.js';

/**
 * @param {string} fileArg
 */
function resolveBackupPath(fileArg) {
  if (!fileArg) return null;
  if (isAbsolute(fileArg)) return fileArg;
  return resolve(process.cwd(), fileArg);
}

/**
 * @param {object} globalOpts
 * @param {object} cmdOpts
 * @param {string | undefined} fileArg
 */
export async function runRestore(globalOpts, cmdOpts, fileArg) {
  loadEnvFile(globalOpts.envFile);
  const { config } = loadConfig({ configPath: globalOpts.config });
  const merged = mergeWithCli(config, {});
  const backupDir = resolve(process.cwd(), merged.backupDir || './backups');

  const envVar = globalOpts.envVar || 'DATABASE_URL';
  const parsed = parseDatabaseUrl(process.env[envVar]);

  let filePath = fileArg ? resolveBackupPath(fileArg, backupDir) : null;

  if (cmdOpts.interactive || !filePath) {
    const dbFilter = cmdOpts.database || parsed.database;
    let entries = filterBackups(scanBackups(backupDir), {
      database: dbFilter || undefined,
    });
    if (entries.length === 0 && dbFilter) {
      ui.warnLine(
        `${ui.icons.warn} No backups matched database filter; showing all backups.`
      );
      entries = scanBackups(backupDir);
    }
    if (entries.length === 0) {
      throw new BackupError('📭 No backups found', 'Run dbsync export first');
    }
    ui.infoLine(`${ui.icons.pkg} Available backups${parsed.database ? ` for '${parsed.database}'` : ''}:\n`);
    entries.forEach((e, i) => {
      const when = (e.parsedDate ?? e.mtime).toISOString().slice(0, 10);
      ui.infoLine(
        `${i + 1}. ${e.filename} (${formatBytes(e.size)}) - ${when}`
      );
    });
    const ans = await ask(`\nSelect backup to restore (1-${entries.length}) or 'q' to quit: `);
    if (ans.trim().toLowerCase() === 'q') {
      process.exit(0);
    }
    const n = Number(ans.trim());
    if (!Number.isInteger(n) || n < 1 || n > entries.length) {
      throw new AppError('Invalid selection');
    }
    filePath = entries[n - 1].path;
  }

  if (!filePath || !existsSync(filePath)) {
    throw new BackupError('Invalid backup file', 'Check the path and try again');
  }

  const isGzip = filePath.endsWith('.gz');
  if (cmdOpts.dryRun) {
    await validateBackupFile(filePath, isGzip);
    ui.success(`${ui.icons.ok} Backup file looks valid (dry-run)`);
    return;
  }

  if (!cmdOpts.force) {
    ui.warnLine(
      `${ui.icons.warn} Warning: This will overwrite current database '${parsed.database || 'default'}'`
    );
    const ok = await confirm('Continue? (y/N): ');
    if (!ok) {
      ui.infoLine('Cancelled.');
      process.exit(0);
    }
  }

  if (cmdOpts.dropBefore) {
    ui.infoLine(`${ui.icons.warn} Dropping and recreating database...`);
    if (parsed.type === 'postgres') {
      await dropPostgresDatabase(parsed);
    } else {
      await dropMysqlDatabase(parsed);
    }
  }

  const masked = parsed.url.toString().replace(/:[^:@/]+@/, ':***@');
  ui.infoLine(`${ui.icons.spin} Restoring from ${filePath.split(/[/\\]/).pop()}...`);
  ui.infoLine(`${ui.icons.link} Connected to ${masked}`);

  const st = statSync(filePath);
  const bar = createFileProgressBar(`${ui.icons.save} Restoring...`, st.size, {
    verbose: globalOpts.verbose,
  });
  bar.start();

  const readStream = createReadStream(filePath);
  const decompress = createDecompressStream(isGzip);
  const counter = new PassThrough();
  counter.on('data', (c) => bar.increment(c.length));

  const child =
    parsed.type === 'postgres' ? spawnPsqlRestore(parsed) : spawnMysqlRestore(parsed);

  let stderr = '';
  child.stderr?.on('data', (c) => {
    stderr += c.toString();
  });

  const t0 = Date.now();
  const closePromise = once(child, 'close');
  try {
    await pipeline(readStream, decompress, counter, child.stdin);
    const [code] = await closePromise;
    bar.stop();
    if (code !== 0) {
      throw new AppError(`Restore process exited with code ${code}`, {
        suggestion: stderr.trim() || 'Check psql/mysql client and permissions',
      });
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    ui.success(`${ui.icons.ok} Restore completed successfully (${secs}s)`);
  } catch (e) {
    bar.stop();
    throw e;
  }
}
