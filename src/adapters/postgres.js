import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { AppError } from '../utils/errors.js';

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export function pgConnectionEnv(parsed) {
  const env = {
    ...process.env,
    PGPASSWORD: parsed.password,
    PGHOST: parsed.host,
    PGUSER: parsed.user,
    PGDATABASE: parsed.database,
  };
  if (parsed.port) env.PGPORT = String(parsed.port);
  const ssl = parsed.url.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  // libpq may prefer DATABASE_URL over PG* vars; Symfony/Doctrine URIs often
  // include ?serverVersion=… which psql rejects. CLI always uses explicit -h/-U/-d.
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  return env;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {{ schemaOnly?: boolean, dataOnly?: boolean, tables?: string[] }} opts
 */
export function buildPgDumpArgs(parsed, opts = {}) {
  const args = ['-h', parsed.host, '-U', parsed.user];
  if (parsed.port) args.push('-p', String(parsed.port));
  args.push('-d', parsed.database);
  // Portable dumps: avoid source-only roles and ACLs so restores work on other clusters.
  args.push('--no-owner', '--no-acl');
  if (opts.schemaOnly) args.push('--schema-only');
  if (opts.dataOnly) args.push('--data-only');
  if (opts.tables?.length) {
    for (const t of opts.tables) {
      const name = t.trim();
      if (name) args.push('-t', name);
    }
  }
  return args;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {boolean} adminDb - connect to postgres maintenance db
 */
export function buildPsqlArgs(parsed, adminDb = false) {
  const db = adminDb ? 'postgres' : parsed.database;
  const args = ['-h', parsed.host, '-U', parsed.user, '-d', db, '-v', 'ON_ERROR_STOP=1'];
  if (parsed.port) args.push('-p', String(parsed.port));
  return args;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export async function testPostgresConnection(parsed) {
  const client = new pg.Client({
    host: parsed.host,
    port: parsed.port ?? 5432,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database || 'postgres',
    ssl: sslOptionFromUrl(parsed),
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError('Cannot connect to database', {
      suggestion: `Check credentials and host. ${msg}`,
    });
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
function sslOptionFromUrl(parsed) {
  const mode = parsed.url.searchParams.get('sslmode');
  if (!mode || mode === 'disable') return undefined;
  return { rejectUnauthorized: mode !== 'no-verify' };
}

/**
 * Spawn pg_dump; returns child with stdout stream.
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {{ schemaOnly?: boolean, dataOnly?: boolean, tables?: string[] }} opts
 */
export function spawnPgDump(parsed, opts = {}) {
  const args = buildPgDumpArgs(parsed, opts);
  const child = spawn('pg_dump', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: pgConnectionEnv(parsed),
  });
  return child;
}

/**
 * Spawn psql reading SQL from stdin.
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {{ admin?: boolean }} opts
 */
export function spawnPsqlRestore(parsed, opts = {}) {
  const args = buildPsqlArgs(parsed, !!opts.admin);
  const admin = !!opts.admin;
  const env = {
    ...pgConnectionEnv(parsed),
    PGDATABASE: admin ? 'postgres' : parsed.database,
  };
  const child = spawn('psql', args, {
    // Discard stdout: unread pipe buffers can fill and block psql during large restores.
    stdio: ['pipe', 'ignore', 'pipe'],
    env,
  });
  return child;
}

/**
 * Drop and recreate database (connect to postgres).
 * psql runs all statements in a single `-c "…;…;…"` inside one transaction;
 * DROP DATABASE / CREATE DATABASE are not allowed in a transaction block, so each step is a separate invocation.
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export async function dropPostgresDatabase(parsed) {
  const dbId = quoteIdent(parsed.database);
  const dbLit = literal(parsed.database);
  const env = { ...pgConnectionEnv(parsed), PGDATABASE: 'postgres' };
  const psqlArgsBase = buildPsqlArgs(parsed, true);

  /**
   * @param {string} sql
   * @param {string} [stepLabel]
   */
  async function runPsql(sql, stepLabel = '') {
    const child = spawn('psql', [...psqlArgsBase, '-c', sql], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env,
    });
    let err = '';
    child.stderr?.on('data', (c) => {
      err += c.toString();
    });
    const [code] = await once(child, 'close');
    if (code !== 0) {
      let hint = [stepLabel && `${stepLabel}: `, err.trim()].filter(Boolean).join('');
      if (/password authentication failed|authentication failed/i.test(hint)) {
        hint +=
          '\nIf DATABASE_URL uses an app-only user, set DBSYNC_ADMIN_URL (or --admin-url) to a superuser on the same host:port.';
      }
      throw new AppError('Failed to drop/recreate database', { suggestion: hint || undefined });
    }
  }

  await runPsql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${dbLit} AND pid <> pg_backend_pid();`,
    'terminate backends'
  );
  await runPsql(`DROP DATABASE IF EXISTS ${dbId};`, 'DROP DATABASE');
  await runPsql(`CREATE DATABASE ${dbId};`, 'CREATE DATABASE');
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function literal(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}
