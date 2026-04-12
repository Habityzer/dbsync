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
import { createPostgresPrivilegeStripTransform } from '../utils/sql-owner-strip.js';

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
        'No backups matched database filter; showing all backups.'
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
    ui.success('Backup file looks valid (dry-run)');
    return;
  }

  const dropBefore = cmdOpts.noDropBefore !== true;
  const skipConfirm = cmdOpts.yes === true || cmdOpts.force === true;
  const stripPgPrivileges =
    parsed.type === 'postgres' && cmdOpts.preservePrivileges !== true;

  const dbLabel = parsed.database || 'default';
  if (dropBefore) {
    ui.warnLine(
      `This will DROP and recreate database '${dbLabel}', then restore from the backup.`
    );
    if (stripPgPrivileges) {
      ui.noteLine(
        'PostgreSQL: owner/privilege statements in the dump are skipped by default (cross-environment safe).'
      );
    }
  } else {
    ui.warnLine(
      `This will import into the existing database '${dbLabel}' without dropping it first.`
    );
  }

  if (!skipConfirm) {
    const ok = await confirm('Continue? (y/N): ');
    if (!ok) {
      ui.infoLine('Cancelled.');
      process.exit(0);
    }
  }

  if (dropBefore) {
    ui.warnLine('Dropping and recreating database...');
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

  const privilegeStrip = stripPgPrivileges
    ? createPostgresPrivilegeStripTransform({ stripGrants: true })
    : null;

  const t0 = Date.now();
  const closePromise = once(child, 'close');
  try {
    if (privilegeStrip) {
      await pipeline(
        readStream,
        decompress,
        privilegeStrip,
        counter,
        child.stdin
      );
    } else {
      await pipeline(readStream, decompress, counter, child.stdin);
    }
    const [code] = await closePromise;
    bar.stop();
    if (code !== 0) {
      throw new AppError(`Restore process exited with code ${code}`, {
        suggestion: stderr.trim() || 'Check psql/mysql client and permissions',
      });
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    ui.success(`Restore completed successfully (${secs}s)`);
  } catch (e) {
    bar.stop();
    if (e instanceof AppError) {
      throw e;
    }
    try {
      await Promise.race([
        closePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10_000)
        ),
      ]);
    } catch {
      /* ignore */
    }
    const errText = stderr.trim();
    if (errText) {
      throw new AppError('Restore failed', { suggestion: errText });
    }
    const isEpipe =
      (typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        /** @type {{ code?: string }} */ (e).code === 'EPIPE') ||
      (e instanceof Error && /EPIPE/i.test(e.message));
    if (isEpipe) {
      throw new AppError('Restore failed: database client exited before the dump finished', {
        suggestion:
          'psql/mysql stopped early (often a SQL error). Re-run; if stderr stays empty, check client and server logs.',
      });
    }
    throw e;
  }
}
