import { describe, it, expect } from 'vitest';
import {
  fixPostgresProtocol,
  stripNonEssentialQueryParams,
  parseDatabaseUrl,
  withAdminCredentials,
} from '../src/utils/url-parser.js';

describe('url-parser', () => {
  it('fixes postgresql:// to postgres://', () => {
    expect(fixPostgresProtocol('postgresql://u:p@h/db')).toBe('postgres://u:p@h/db');
  });

  it('strips doctrine params', () => {
    const s = stripNonEssentialQueryParams(
      'postgres://u:p@127.0.0.1:5432/app?serverVersion=16&charset=utf8&driver=pdo_pgsql&sslmode=disable'
    );
    expect(s).toContain('sslmode=disable');
    expect(s).not.toContain('serverVersion');
    expect(s).not.toContain('charset');
    expect(s).not.toContain('driver');
  });

  it('parses password with !', () => {
    const raw =
      'postgresql://app:!ChangeMe!@127.0.0.1:5434/app?serverVersion=16';
    const p = parseDatabaseUrl(raw);
    expect(p.type).toBe('postgres');
    expect(p.user).toBe('app');
    expect(p.password).toBe('!ChangeMe!');
    expect(p.database).toBe('app');
    expect(p.host).toBe('127.0.0.1');
    expect(p.port).toBe(5434);
  });

  it('parses mysql URL', () => {
    const p = parseDatabaseUrl('mysql://root:secret@localhost:3306/mydb');
    expect(p.type).toBe('mysql');
    expect(p.database).toBe('mydb');
  });

  it('withAdminCredentials swaps login for same server/db', () => {
    const target = parseDatabaseUrl(
      'postgres://app:wrong@127.0.0.1:5434/flumi_prod'
    );
    const admin = parseDatabaseUrl(
      'postgres://postgres:secret@127.0.0.1:5434/postgres'
    );
    const merged = withAdminCredentials(target, admin);
    expect(merged.user).toBe('postgres');
    expect(merged.password).toBe('secret');
    expect(merged.database).toBe('flumi_prod');
    expect(merged.host).toBe('127.0.0.1');
    expect(merged.port).toBe(5434);
  });

  it('withAdminCredentials rejects different host', () => {
    const target = parseDatabaseUrl('postgres://a:b@127.0.0.1:5432/db');
    const admin = parseDatabaseUrl('postgres://x:y@127.0.0.2:5432/postgres');
    expect(() => withAdminCredentials(target, admin)).toThrow(/same host/);
  });
});
