import { ConfigError } from './errors.js';

const STRIP_PARAMS = new Set(['serverVersion', 'charset', 'driver']);

/**
 * @typedef {'postgres' | 'mysql'} DbType
 * @typedef {object} ParsedDatabaseUrl
 * @property {DbType} type
 * @property {string} protocol
 * @property {string} host
 * @property {number} [port]
 * @property {string} user
 * @property {string} password
 * @property {string} database
 * @property {string} hrefForTools - URL without stripped params, for tools that accept URI
 * @property {URL} url
 */

/**
 * Strip doctrine/non-essential query params from a database URL string.
 * @param {string} input
 */
export function stripNonEssentialQueryParams(input) {
  let s = String(input).trim();
  const hashIdx = s.indexOf('#');
  const hash = hashIdx >= 0 ? s.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const qIdx = noHash.indexOf('?');
  if (qIdx < 0) return s;
  const base = noHash.slice(0, qIdx);
  const qs = noHrefSearchParams(noHash.slice(qIdx + 1));
  const sp = new URLSearchParams(qs);
  for (const k of STRIP_PARAMS) {
    sp.delete(k);
  }
  const rest = sp.toString();
  return base + (rest ? `?${rest}` : '') + hash;
}

function noHrefSearchParams(qs) {
  return qs.replace(/^\+/, '');
}

/**
 * Fix postgresql:// -> postgres://
 * @param {string} input
 */
export function fixPostgresProtocol(input) {
  return String(input).trim().replace(/^postgresql:/i, 'postgres:');
}

/**
 * Parse user:password from userinfo (password may contain ':').
 * @param {string} userinfo
 */
function splitUserInfo(userinfo) {
  const idx = userinfo.indexOf(':');
  if (idx < 0) {
    return { user: decodeURIComponent(userinfo), password: '' };
  }
  const user = decodeURIComponent(userinfo.slice(0, idx));
  const password = decodeURIComponent(userinfo.slice(idx + 1).replace(/\+/g, ' '));
  return { user, password };
}

/**
 * Manual parse when URL constructor fails (e.g. rare edge cases).
 * @param {string} s - postgres:// or mysql:// without fragment
 */
function parseManual(s) {
  const isMysql = /^mysql:\/\//i.test(s);
  const isPostgres = /^postgres:\/\//i.test(s);
  if (!isMysql && !isPostgres) {
    throw new ConfigError(
      'Unsupported database URL protocol',
      'Use postgresql://, postgres://, or mysql://'
    );
  }
  const type = isMysql ? 'mysql' : 'postgres';
  const scheme = isMysql ? 'mysql:' : 'postgres:';
  const rest = s.replace(/^mysql:\/\//i, '').replace(/^postgres:\/\//i, '');
  const at = rest.lastIndexOf('@');
  if (at < 0) {
    throw new ConfigError('Invalid database URL', 'Expected user@host in DATABASE_URL');
  }
  const userinfo = rest.slice(0, at);
  const afterAt = rest.slice(at + 1);
  const { user, password } = splitUserInfo(userinfo);

  const slash = afterAt.indexOf('/');
  const hostPort = slash >= 0 ? afterAt.slice(0, slash) : afterAt;
  const pathAndQuery = slash >= 0 ? afterAt.slice(slash) : '/';

  let host = hostPort;
  let port;
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    host = hostPort.slice(1, end);
    const colon = hostPort.indexOf(':', end);
    if (colon >= 0) port = Number(hostPort.slice(colon + 1));
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon > 0 && !hostPort.includes(':', colon - 1)) {
      host = hostPort.slice(0, colon);
      port = Number(hostPort.slice(colon + 1));
    }
  }

  const pathMatch = pathAndQuery.match(/^\/([^?]*)(\?.*)?$/);
  const dbName = pathMatch ? decodeURIComponent(pathMatch[1] || '') : '';
  const search = pathMatch?.[2] || '';

  const built = `${scheme}//${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostPort}${pathAndQuery}`;
  let url;
  try {
    url = new URL(built);
  } catch {
    url = new URL(`${scheme}//${hostPort}${pathAndQuery}`);
    url.username = user;
    url.password = password;
  }

  return { type, user, password, database: dbName, host, port, url };
}

/**
 * @param {string} rawUrl
 * @returns {ParsedDatabaseUrl}
 */
export function parseDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !String(rawUrl).trim()) {
    throw new ConfigError(
      'DATABASE_URL is missing or empty',
      'Set DATABASE_URL in .env or use --env-var'
    );
  }

  let s = fixPostgresProtocol(rawUrl);
  s = stripNonEssentialQueryParams(s);

  let type;
  let url;
  let user = '';
  let password = '';
  let database = '';

  try {
    url = new URL(s);
    const proto = url.protocol.replace(/:$/, '').toLowerCase();
    if (proto === 'postgres') {
      type = 'postgres';
    } else if (proto === 'mysql') {
      type = 'mysql';
    } else {
      throw new ConfigError(
        'Unsupported database URL protocol',
        'Use postgresql://, postgres://, or mysql://'
      );
    }
    user = decodeURIComponent(url.username || '');
    password = decodeURIComponent(url.password || '');
    database = decodeURIComponent((url.pathname || '/').replace(/^\//, '') || '');
  } catch {
    const manual = parseManual(s);
    type = manual.type;
    url = manual.url;
    user = manual.user;
    password = manual.password;
    database = manual.database;
  }

  for (const k of STRIP_PARAMS) {
    url.searchParams.delete(k);
  }

  const host = url.hostname || 'localhost';
  const port = url.port ? Number(url.port) : undefined;

  return {
    type,
    protocol: type === 'mysql' ? 'mysql:' : 'postgres:',
    host,
    port,
    user,
    password,
    database,
    hrefForTools: url.toString(),
    url,
  };
}
