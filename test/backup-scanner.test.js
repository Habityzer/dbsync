import { describe, it, expect } from 'vitest';
import { parseBackupFilename } from '../src/utils/backup-scanner.js';

describe('backup-scanner', () => {
  it('parses standard backup filename', () => {
    const { database, parsedDate } = parseBackupFilename('flumi_20260410_143022.sql.gz');
    expect(database).toBe('flumi');
    expect(parsedDate?.getFullYear()).toBe(2026);
    expect(parsedDate?.getMonth()).toBe(3); // April
    expect(parsedDate?.getDate()).toBe(10);
  });

  it('returns undefined for non-matching names', () => {
    const { database } = parseBackupFilename('dump.sql.gz');
    expect(database).toBeUndefined();
  });
});
