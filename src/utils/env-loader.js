import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { ConfigError } from './errors.js';

/**
 * Load .env from cwd-relative path. Does not override existing process.env by default.
 * @param {string} [envFilePath]
 * @param {{ override?: boolean }} [opts]
 */
export function loadEnvFile(envFilePath = '.env', opts = {}) {
  const path = resolve(process.cwd(), envFilePath);
  if (!existsSync(path)) {
    throw new ConfigError(
      'No .env file found',
      `Create ${envFilePath} with DATABASE_URL or pass --env-file <path>`
    );
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = dotenv.parse(raw);
  const override = opts.override ?? false;
  for (const [k, v] of Object.entries(parsed)) {
    if (override || process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return path;
}

/**
 * Try to load .env without throwing (for list/info/clean that may not need DB).
 * @param {string} envFilePath
 */
export function tryLoadEnvFile(envFilePath = '.env') {
  const path = resolve(process.cwd(), envFilePath);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = dotenv.parse(raw);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return path;
}
