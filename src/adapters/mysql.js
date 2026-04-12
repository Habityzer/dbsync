import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { AppError } from '../utils/errors.js';

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export function mysqlConnectionEnv(parsed) {
  const env = {
    ...process.env,
    MYSQL_PWD: parsed.password,
  };
  delete env.DATABASE_URL;
  return env;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export function buildMysqlDumpArgs(parsed, opts = {}) {
  const args = ['-h', parsed.host, '-u', parsed.user];
  if (parsed.port) args.push('-P', String(parsed.port));
  args.push(parsed.database);
  if (opts.schemaOnly) args.push('--no-data');
  if (opts.dataOnly) args.push('--no-create-info');
  if (opts.tables?.length) {
    for (const t of opts.tables) {
      const name = t.trim();
      if (name) args.push(name);
    }
  }
  return args;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export function buildMysqlArgs(parsed) {
  const args = ['-h', parsed.host, '-u', parsed.user];
  if (parsed.port) args.push('-P', String(parsed.port));
  args.push(parsed.database);
  return args;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export async function testMysqlConnection(parsed) {
  try {
    const conn = await mysql.createConnection({
      host: parsed.host,
      port: parsed.port ?? 3306,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database || undefined,
    });
    await conn.query('SELECT 1');
    await conn.end();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError('Cannot connect to database', {
      suggestion: `Check credentials and host. ${msg}`,
    });
  }
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 * @param {{ schemaOnly?: boolean, dataOnly?: boolean, tables?: string[] }} opts
 */
export function spawnMysqldump(parsed, opts = {}) {
  const args = buildMysqlDumpArgs(parsed, opts);
  const child = spawn('mysqldump', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: mysqlConnectionEnv(parsed),
  });
  return child;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export function spawnMysqlRestore(parsed) {
  const args = buildMysqlArgs(parsed);
  const child = spawn('mysql', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: mysqlConnectionEnv(parsed),
  });
  return child;
}

/**
 * @param {import('../utils/url-parser.js').ParsedDatabaseUrl} parsed
 */
export async function dropMysqlDatabase(parsed) {
  const db = quoteMySqlIdent(parsed.database);
  const sql = `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};`;
  const args = ['-h', parsed.host, '-u', parsed.user];
  if (parsed.port) args.push('-P', String(parsed.port));
  args.push('-e', sql);
  const child = spawn('mysql', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: mysqlConnectionEnv(parsed),
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

function quoteMySqlIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}
