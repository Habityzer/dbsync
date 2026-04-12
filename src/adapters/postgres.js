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
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  return child;
}

/**
 * Drop and recreate database (connect to postgres).
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export async function dropPostgresDatabase(parsed) {
  const dbId = quoteIdent(parsed.database);
  const sql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${literal(parsed.database)} AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS ${dbId}; CREATE DATABASE ${dbId};`;
  const env = { ...pgConnectionEnv(parsed), PGDATABASE: 'postgres' };
  const child = spawn('psql', [...buildPsqlArgs(parsed, true), '-c', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let err = '';
  child.stderr?.on('data', (c) => {
    err += c.toString();
  });
  const [code] = await once(child, 'close');
  if (code !== 0) {
    throw new AppError('Failed to drop/recreate database', { suggestion: err.trim() });
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function literal(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}
