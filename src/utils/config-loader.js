import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_NAMES = ['.db-sync.json', '.db-syncconfig.json'];

/**
 * @typedef {object} DbSyncConfig
 * @property {string} [backupDir]
 * @property {boolean} [compress]
 * @property {number} [compressLevel]
 * @property {number} [keepLast]
 * @property {string} [timestampFormat]
 */

/**
 * Deep merge plain objects (shallow per key).
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} over
 */
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = merge(
        typeof base[k] === 'object' && base[k] !== null ? /** @type {Record<string, unknown>} */ (base[k]) : {},
        /** @type {Record<string, unknown>} */ (v)
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Find first existing config file in cwd.
 * @param {string} [cwd]
 */
export function discoverConfigPath(cwd = process.cwd()) {
  for (const name of DEFAULT_NAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {DbSyncConfig}
 */
export function readConfigFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Load optional config: explicit path or first default in cwd.
 * @param {{ configPath?: string, cwd?: string }} opts
 * @returns {{ config: DbSyncConfig, path: string | null }}
 */
export function loadConfig(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const explicit = opts.configPath ? resolve(cwd, opts.configPath) : null;
  const path = explicit && existsSync(explicit) ? explicit : discoverConfigPath(cwd);
  if (!path) {
    return { config: {}, path: null };
  }
  return { config: readConfigFile(path), path };
}

/**
 * Merge CLI overrides into config-derived defaults.
 * @param {DbSyncConfig} fileConfig
 * @param {Record<string, unknown>} cliOverrides
 */
export function mergeWithCli(fileConfig, cliOverrides) {
  return merge(
    {
      backupDir: './backups',
      compress: true,
      compressLevel: 6,
      keepLast: 30,
      timestampFormat: 'YYYYMMDD_HHMMSS',
      ...fileConfig,
    },
    cliOverrides
  );
}
