import { describe, it, expect } from 'vitest';
import { planRetention } from '../src/utils/retention.js';

function entry(name, t, size = 1) {
  const d = new Date(t);
  return {
    path: `/b/${name}`,
    filename: name,
    size,
    mtime: d,
    database: 'db',
    parsedDate: d,
    compressed: name.endsWith('.gz'),
  };
}

describe('retention', () => {
  const now = new Date('2026-04-10T12:00:00Z').getTime();
  /** newest first (as scanBackups returns) */
  const list = [
    entry('c.sql.gz', now - 86400000),
    entry('b.sql.gz', now - 86400000 * 5),
    entry('a.sql.gz', now - 86400000 * 10),
  ];

  it('keeps only newest N when keepLast set', () => {
    const { keep, remove } = planRetention(list, { keepLast: 2, now });
    expect(keep.map((e) => e.filename)).toEqual(['c.sql.gz', 'b.sql.gz']);
    expect(remove.map((e) => e.filename)).toEqual(['a.sql.gz']);
  });

  it('keeps files within keepDays', () => {
    const { remove } = planRetention(list, { keepDays: 6, now });
    expect(remove.map((e) => e.filename)).toEqual(['a.sql.gz']);
  });

  it('union keep: keep if in top N OR within days', () => {
    const { keep } = planRetention(list, { keepLast: 1, keepDays: 20, now });
    expect(new Set(keep.map((e) => e.filename))).toEqual(
      new Set(['c.sql.gz', 'b.sql.gz', 'a.sql.gz'])
    );
  });
});
