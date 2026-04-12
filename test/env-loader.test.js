import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from '../src/utils/env-loader.js';

describe('env-loader', () => {
  let prev;
  beforeEach(() => {
    prev = { ...process.env };
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(prev)) {
      process.env[k] = v;
    }
  });

  it('expands ${POSTGRES_PASSWORD} inside DATABASE_URL like Symfony', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbsync-env-'));
    const orig = process.cwd();
    try {
      writeFileSync(
        join(dir, '.env'),
        'POSTGRES_PASSWORD=secretpw\nDATABASE_URL=postgresql://app:${POSTGRES_PASSWORD}@127.0.0.1:5432/db\n'
      );
      process.chdir(dir);
      loadEnvFile('.env', { override: true });
      expect(process.env.DATABASE_URL).toBe(
        'postgresql://app:secretpw@127.0.0.1:5432/db'
      );
    } finally {
      process.chdir(orig);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
