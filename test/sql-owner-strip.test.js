import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createPostgresPrivilegeStripTransform } from '../src/utils/sql-owner-strip.js';

/**
 * @param {Buffer[]} chunks
 * @param {Parameters<typeof createPostgresPrivilegeStripTransform>[0]} opts
 */
async function filter(chunks, opts = { stripGrants: true }) {
  const transform = createPostgresPrivilegeStripTransform(opts);
  const out = [];
  for await (const c of Readable.from(chunks).pipe(transform)) out.push(c);
  return { text: Buffer.concat(out).toString('utf8'), bytes: Buffer.concat(out), stats: transform.stats };
}

/** Split a buffer into chunks of `size` bytes, ignoring character boundaries. */
function chunked(buf, size) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += size) chunks.push(buf.subarray(i, i + size));
  return chunks;
}

const COPY_BLOCK = [
  'COPY public.grammar_questions (id, template, explanation) FROM stdin;',
  '01a07864-176e\t이것은 민수__1__ 책이에요.\t민수 owns the book, so 의 links the owner to the thing owned.',
  '01a07864-176f\tGRANT me a wish\tREVOKE ALL is just text here;',
  '01a07864-1770\tALTER TABLE x OWNER TO y;\t\\N',
  '\\.',
].join('\n');

describe('createPostgresPrivilegeStripTransform', () => {
  it('keeps COPY rows that mention owner to / GRANT / REVOKE', async () => {
    const sql = `SET client_encoding = 'UTF8';\n\n${COPY_BLOCK}\n\n`;
    const { text } = await filter([Buffer.from(sql)]);
    expect(text).toBe(sql);
  });

  it('drops top-level OWNER TO and ACL statements', async () => {
    const sql = [
      'CREATE TABLE public.t (',
      '    id integer NOT NULL',
      ');',
      '',
      '',
      'ALTER TABLE public.t OWNER TO prod_user;',
      '',
      '--',
      '-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner',
      '--',
      '',
      'REVOKE USAGE ON SCHEMA public FROM PUBLIC;',
      'GRANT ALL ON SCHEMA public TO PUBLIC;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE prod_user IN SCHEMA public GRANT ALL ON TABLES TO app;',
      'REASSIGN OWNED BY old_role TO new_role;',
      '',
    ].join('\n');
    const { text, stats } = await filter([Buffer.from(sql)]);
    expect(text).toBe(
      ['CREATE TABLE public.t (', '    id integer NOT NULL', ');', '', '', '', '--',
        '-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner', '--', '', ''].join('\n')
    );
    expect(stats.owner).toBe(2);
    expect(stats.grants).toBe(3);
  });

  it('keeps GRANT/REVOKE when stripGrants is off', async () => {
    const sql = 'GRANT ALL ON SCHEMA public TO PUBLIC;\nALTER TABLE public.t OWNER TO u;\n';
    const { text } = await filter([Buffer.from(sql)], {});
    expect(text).toBe('GRANT ALL ON SCHEMA public TO PUBLIC;\n');
  });

  it('never touches lines inside dollar-quoted bodies or multi-line literals', async () => {
    const sql = [
      'CREATE FUNCTION public.f() RETURNS void',
      '    LANGUAGE sql',
      '    AS $_$',
      'SELECT 1;',
      'GRANT SELECT ON public.t TO reader;',
      '$_$;',
      '',
      "COMMENT ON TABLE public.t IS 'first line;",
      'GRANT this is prose;',
      "ALTER x OWNER TO y;';",
      '',
    ].join('\n');
    const { text } = await filter([Buffer.from(sql)]);
    expect(text).toBe(sql);
  });

  it('drops only statements that start at a statement boundary', async () => {
    const sql = ['CREATE VIEW public.v AS', ' SELECT 1 AS n', 'GRANT ALL ON public.t TO x;', ''].join('\n');
    const { text } = await filter([Buffer.from(sql)]);
    expect(text).toBe(sql);
  });

  it('is byte-exact when multi-byte characters straddle chunk boundaries', async () => {
    const sql = Buffer.from(`${COPY_BLOCK}\nCOPY public.p (t) FROM stdin;\nΚαλημέρα 日本語 Привіт 한국어\n\\.\n`);
    for (const size of [1, 2, 3, 5, 7, 16]) {
      const { bytes } = await filter(chunked(sql, size));
      expect(bytes.equals(sql)).toBe(true);
    }
  });

  it('passes bytes that are not valid UTF-8 through unchanged', async () => {
    const sql = Buffer.concat([
      Buffer.from('COPY public.raw (b) FROM stdin;\n'),
      Buffer.from([0x61, 0xff, 0xfe, 0xc3, 0x0a]),
      Buffer.from('\\.\n'),
    ]);
    const { bytes } = await filter(chunked(sql, 3));
    expect(bytes.equals(sql)).toBe(true);
  });

  it('skips CREATE/COMMENT ON EXTENSION for the named extensions only', async () => {
    const sql = [
      'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;',
      '',
      "COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';",
      '',
      'CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;',
      '',
      "COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;',
      '',
    ].join('\n');
    const { text, stats } = await filter([Buffer.from(sql)], {
      stripOwners: false,
      skipExtensions: ['pg_stat_statements', 'uuid-ossp'],
    });
    expect(text).toBe(
      [
        '',
        '',
        'CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;',
        '',
        "COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';",
        '',
      ].join('\n')
    );
    expect([...stats.extensions]).toEqual(['pg_stat_statements', 'uuid-ossp']);
  });

  it('keeps the last line when the dump has no trailing newline', async () => {
    const { text } = await filter([Buffer.from('SELECT 1;\nGRANT ALL ON t TO u;')]);
    expect(text).toBe('SELECT 1;\n');
    const kept = await filter([Buffer.from('SELECT 1;\nSELECT 2;')]);
    expect(kept.text).toBe('SELECT 1;\nSELECT 2;');
  });
});
