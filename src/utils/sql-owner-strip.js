import { Transform } from 'node:stream';

const COPY_FROM_STDIN = /^COPY\s.+\sFROM\s+stdin;$/i;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;
const IDENT_CHAR = /[A-Za-z0-9_\u0080-￿]/;
const EXTENSION_STATEMENT =
  /^(?:CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?|COMMENT\s+ON\s+EXTENSION\s+)("(?:[^"]|"")+"|[^\s";]+)/i;

/**
 * Filter plain pg_dump SQL line by line on its way to psql:
 * - drop role-bound statements (ALTER … OWNER TO, REASSIGN OWNED, and with
 *   `stripGrants` GRANT / REVOKE / ALTER DEFAULT PRIVILEGES) so restores work
 *   when the target cluster does not have the same roles (e.g. local dev);
 * - drop CREATE EXTENSION / COMMENT ON EXTENSION for the names in
 *   `skipExtensions` (superuser-only extensions the restoring role cannot create).
 *
 * Only a complete one-line statement that starts at a statement boundary is
 * ever dropped. COPY … FROM stdin data, quoted literals and dollar-quoted
 * bodies pass through untouched: a row that happens to contain "owner to" is
 * data, not a statement.
 *
 * The stream is byte-transparent: chunks are read and written as latin1, which
 * maps every byte to one character and back, so a multi-byte UTF-8 character
 * split across two chunks (or bytes that are not UTF-8 at all) reach psql
 * exactly as they are in the dump.
 *
 * `transform.stats` counts what was dropped: `{ owner, grants, extensions: Set<string> }`.
 * @param {{ stripOwners?: boolean, stripGrants?: boolean, skipExtensions?: string[] }} opts
 */
export function createPostgresPrivilegeStripTransform(opts = {}) {
  const stripOwners = opts.stripOwners !== false;
  const stripGrants = opts.stripGrants === true;
  const skipExtensions = new Set(opts.skipExtensions ?? []);
  const stats = { owner: 0, grants: 0, extensions: new Set() };

  let remainder = '';
  let inCopy = false;
  /** Lexical state carried across the lines of a multi-line statement. */
  let lex = { dollarTag: null, inQuote: false, inIdent: false };
  let atStatementStart = true;

  /**
   * @param {string} text one statement line, trimmed
   * @returns {'owner' | 'grants' | 'extension' | null}
   */
  function dropKind(text) {
    if (stripOwners && /^ALTER\s.+\sOWNER\s+TO\s.+;$/i.test(text)) return 'owner';
    if (stripOwners && /^REASSIGN\s+OWNED\b.*;$/i.test(text)) return 'owner';
    if (stripGrants && /^(?:GRANT|REVOKE)\s.*;$/i.test(text)) return 'grants';
    if (stripGrants && /^ALTER\s+DEFAULT\s+PRIVILEGES\s.*;$/i.test(text)) return 'grants';
    const ext = skipExtensions.size ? EXTENSION_STATEMENT.exec(text) : null;
    if (ext && skipExtensions.has(identifierName(ext[1]))) {
      stats.extensions.add(identifierName(ext[1]));
      return 'extension';
    }
    return null;
  }

  /**
   * @param {string} line without its trailing \n
   * @returns {boolean} keep the line
   */
  function keep(line) {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (inCopy) {
      if (text === '\\.') inCopy = false;
      return true;
    }
    const inLiteral = lex.dollarTag !== null || lex.inQuote || lex.inIdent;
    const trimmed = text.trim();
    if (!inLiteral) {
      if (trimmed === '' || trimmed.startsWith('--')) return true;
      if (trimmed.startsWith('\\')) {
        // psql meta-command (\connect, \restrict …): a statement of its own.
        atStatementStart = true;
        return true;
      }
    }
    const after = scanLine(text, lex);
    const complete = after.dollarTag === null && !after.inQuote && !after.inIdent;
    if (!inLiteral && atStatementStart && complete) {
      if (COPY_FROM_STDIN.test(trimmed)) {
        inCopy = true;
        return true;
      }
      const kind = dropKind(trimmed);
      if (kind === 'owner') stats.owner++;
      if (kind === 'grants') stats.grants++;
      if (kind) return false;
    }
    lex = after;
    atStatementStart = complete && trimmed.endsWith(';');
    return true;
  }

  const transform = new Transform({
    transform(chunk, _enc, cb) {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
      const parts = remainder.split('\n');
      remainder = parts.pop() ?? '';
      let out = '';
      for (const line of parts) {
        if (keep(line)) out += `${line}\n`;
      }
      cb(null, out ? Buffer.from(out, 'latin1') : undefined);
    },
    flush(cb) {
      if (remainder !== '' && keep(remainder)) {
        this.push(Buffer.from(remainder, 'latin1'));
      }
      cb();
    },
  });
  transform.stats = stats;
  return transform;
}

/**
 * Follow quotes and dollar quotes through one line of SQL.
 * @param {string} text
 * @param {{ dollarTag: string | null, inQuote: boolean, inIdent: boolean }} state at line start
 */
export function scanLine(text, state) {
  let { dollarTag, inQuote, inIdent } = state;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (dollarTag !== null) {
      if (c === '$' && text.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
    } else if (inQuote) {
      if (c === "'") inQuote = false; // '' re-opens on the next character
    } else if (inIdent) {
      if (c === '"') inIdent = false;
    } else if (c === "'") {
      inQuote = true;
    } else if (c === '"') {
      inIdent = true;
    } else if (c === '-' && text[i + 1] === '-') {
      break;
    } else if (c === '$' && !(i > 0 && IDENT_CHAR.test(text[i - 1]))) {
      const m = DOLLAR_TAG.exec(text.slice(i));
      if (m) {
        dollarTag = m[0];
        i += m[0].length - 1;
      }
    }
  }
  return { dollarTag, inQuote, inIdent };
}

/**
 * @param {string} raw identifier as written in the dump
 */
function identifierName(raw) {
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/""/g, '"');
  return raw.toLowerCase();
}
