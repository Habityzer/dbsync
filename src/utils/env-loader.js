import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { ConfigError } from './errors.js';

/** Symfony-style ${VAR} in values (dotenv.parse does not expand these). */
const VAR_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * @param {string} value
 * @param {Record<string, string>} ctx
 */
function expandPlaceholders(value, ctx) {
  return value.replace(VAR_REF, (full, name) => {
    if (ctx[name] !== undefined && ctx[name] !== null) {
      return String(ctx[name]);
    }
    if (process.env[name] !== undefined) {
      return process.env[name];
    }
    return full;
  });
}

/**
 * @param {Record<string, string>} parsed
 */
function expandParsedEnv(parsed) {
  const out = { ...parsed };
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (const k of Object.keys(out)) {
      const next = expandPlaceholders(out[k], out);
      if (next !== out[k]) {
        out[k] = next;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return out;
}

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
  let parsed = dotenv.parse(raw);
  parsed = expandParsedEnv(parsed);
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
  let parsed = dotenv.parse(raw);
  parsed = expandParsedEnv(parsed);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return path;
}
