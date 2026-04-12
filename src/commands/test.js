import { loadEnvFile } from '../utils/env-loader.js';
import { parseDatabaseUrl } from '../utils/url-parser.js';
import { testPostgresConnection } from '../adapters/postgres.js';
import { testMysqlConnection } from '../adapters/mysql.js';
import * as ui from '../utils/ui.js';

/**
 * @param {object} globalOpts
 */
export async function runTest(globalOpts) {
  loadEnvFile(globalOpts.envFile);
  const envVar = globalOpts.envVar || 'DATABASE_URL';
  const raw = process.env[envVar];
  const parsed = parseDatabaseUrl(raw);

  if (/[!@#$%]/.test(parsed.password)) {
    ui.warnLine(
      'Password contains special characters — auto-encoded for URL parsing; verify connection if it fails.'
    );
  }

  if (parsed.type === 'postgres') {
    await testPostgresConnection(parsed);
  } else {
    await testMysqlConnection(parsed);
  }

  ui.success('Connection OK');
}
