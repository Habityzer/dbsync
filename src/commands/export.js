import {
  createWriteStream,
  mkdirSync,
  statSync,
  existsSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { loadEnvFile } from '../utils/env-loader.js';
import { loadConfig, mergeWithCli } from '../utils/config-loader.js';
import { parseDatabaseUrl } from '../utils/url-parser.js';
import { createCompressStream } from '../utils/compression.js';
import { createStreamProgress, formatBytes } from '../utils/progress.js';
import { AppError, FileSystemError } from '../utils/errors.js';
import * as ui from '../utils/ui.js';
import { spawnPgDump } from '../adapters/postgres.js';
import { spawnMysqldump } from '../adapters/mysql.js';

function timestampSuffix() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

/**
 * @param {object} opts
 */
function resolveOutputPath(opts) {
  const dbName = opts.dbName || 'database';
  const compress = opts.compress !== false;
  const ext = compress ? '.sql.gz' : '.sql';
  const name = `${dbName}_${timestampSuffix()}${ext}`;
  const backupDir = resolve(process.cwd(), opts.backupDir || './backups');

  if (!opts.output) {
    return { filePath: join(backupDir, name), backupDir };
  }

  const out = opts.output;
  const resolved = isAbsolute(out) ? out : resolve(process.cwd(), out);

  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return { filePath: join(resolved, name), backupDir: resolved };
  }

  if (out.endsWith('/') || out.endsWith('\\')) {
    const dir = resolve(process.cwd(), out);
    return { filePath: join(dir, name), backupDir: dir };
  }

  if (/\.sql(\.gz)?$/i.test(out)) {
    return { filePath: resolved, backupDir: dirname(resolved) };
  }

  return { filePath: join(resolved, name), backupDir: resolved };
}

/**
 * @param {string} dir
 */
function ensureWritableDirSync(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const test = join(dir, '.dbsync-write-test');
    writeFileSync(test, 'ok');
    unlinkSync(test);
  } catch {
    throw new FileSystemError(
      `Cannot write to ${dir}`,
      'Check permissions or create the directory'
    );
  }
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {{ schemaOnly?: boolean, dataOnly?: boolean, tables?: string[] }} dumpOpts
 * @param {import('node:stream').Transform | import('node:stream').PassThrough} compressStream
 * @param {import('node:fs').WriteStream} writeStream
 * @param {{ verbose?: boolean }} ctx
 */
async function runDumpPipeline(parsed, dumpOpts, compressStream, writeStream, ctx) {
  const child =
    parsed.type === 'postgres'
      ? spawnPgDump(parsed, dumpOpts)
      : spawnMysqldump(parsed, dumpOpts);

  let stderr = '';
  child.stderr?.on('data', (c) => {
    stderr += c.toString();
  });

  const progress = createStreamProgress(`${ui.icons.save} Exporting...`, ctx);
  progress.start();
  const t0 = Date.now();

  const counter = new PassThrough();
  counter.on('data', (chunk) => progress.increment(chunk.length));

  // Subscribe before pipeline: if 'close' fires before we await, `once` would miss it and hang.
  const closePromise = once(child, 'close');

  try {
    await pipeline(child.stdout, compressStream, counter, writeStream);
    const [code] = await closePromise;
    if (code !== 0) {
      progress.fail(`${ui.icons.err} Export failed`);
      throw new AppError(`Dump process exited with code ${code}`, {
        suggestion: stderr.trim() || 'Check pg_dump/mysqldump are installed',
      });
    }
    const bytes = typeof progress.getBytes === 'function' ? progress.getBytes() : 0;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    progress.succeed(`${ui.icons.save} ${formatBytes(bytes)} in ${secs}s`);
  } catch (e) {
    if (e instanceof AppError) throw e;
    progress.fail(`${ui.icons.err} Export failed`);
    throw e;
  }
}

/**
 * @param {object} globalOpts
 * @param {object} cmdOpts
 */
export async function runExport(globalOpts, cmdOpts) {
  loadEnvFile(globalOpts.envFile);
  const { config } = loadConfig({ configPath: globalOpts.config });
  const merged = mergeWithCli(config, {});

  const envVar = globalOpts.envVar || 'DATABASE_URL';
  const rawUrl = process.env[envVar];
  const parsed = parseDatabaseUrl(rawUrl);

  if (/[!@#$%]/.test(parsed.password)) {
    ui.warnLine(
      `${ui.icons.warn} Password contains special characters — encoded for connection. Verify if connection fails.`
    );
  }

  const compress = merged.compress !== false && !cmdOpts.noCompress;
  let level = Number(cmdOpts.compressLevel ?? merged.compressLevel ?? 6);
  if (!Number.isFinite(level)) level = 6;
  level = Math.min(9, Math.max(1, level));
  const tables = cmdOpts.tables
    ? String(cmdOpts.tables)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  if (cmdOpts.schemaOnly && cmdOpts.dataOnly) {
    throw new AppError('Cannot use --schema-only and --data-only together');
  }

  const { filePath, backupDir } = resolveOutputPath({
    dbName: parsed.database || 'database',
    compress,
    output: cmdOpts.output,
    backupDir: merged.backupDir,
  });

  ensureWritableDirSync(backupDir);

  const masked = parsed.url.toString().replace(/:[^:@/]+@/, ':***@');
  ui.infoLine(`${ui.icons.pkg} Exporting database '${parsed.database || 'default'}'...`);
  ui.infoLine(`${ui.icons.link} Connected to ${masked}`);

  const compressStream = createCompressStream(compress, level);
  const writeStream = createWriteStream(filePath);

  const dumpOpts = {
    schemaOnly: !!cmdOpts.schemaOnly,
    dataOnly: !!cmdOpts.dataOnly,
    tables,
  };

  await runDumpPipeline(parsed, dumpOpts, compressStream, writeStream, {
    verbose: globalOpts.verbose,
  });

  const st = statSync(filePath);
  const compLabel = compress ? `gzip (level ${level})` : 'none';
  ui.success(`${ui.icons.ok} Exported to: ${filePath}`);
  ui.infoLine(`${ui.icons.chart} Size: ${formatBytes(st.size)} | Compression: ${compLabel}`);
}
