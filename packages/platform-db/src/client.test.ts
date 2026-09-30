import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertConnectionRole, createDatabase, getDatabase, isDatabaseConfigured } from './client';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('database client', () => {
  it('reports configuration per login role and fails closed without it', () => {
    vi.stubEnv('DATABASE_URL_APP_SERVER', '');
    vi.stubEnv('DATABASE_URL_APP_WORKER', '');
    expect(isDatabaseConfigured()).toBe(false);
    expect(isDatabaseConfigured('app_worker')).toBe(false);
    expect(() => getDatabase('app_server')).toThrow('DATABASE_URL_APP_SERVER is not configured');
  });

  it('creates one lazily-connecting handle per role (no connection until first query)', () => {
    vi.stubEnv('DATABASE_URL_APP_WORKER', 'postgres://app_worker@127.0.0.1:1/none');
    expect(isDatabaseConfigured('app_worker')).toBe(true);
    const db = getDatabase('app_worker');
    expect(getDatabase('app_worker')).toBe(db);
    expect(typeof createDatabase('postgres://x@127.0.0.1:1/none').transaction).toBe('function');
  });

  it('refuses connection URLs for any other login role (e.g. a superuser)', () => {
    expect(() => {
      assertConnectionRole('postgres://postgres:pw@db:5432/app', 'app_server');
    }).toThrow('must connect as login role app_server');
    expect(() => {
      assertConnectionRole('postgres://app_server:pw@db/app', 'app_worker');
    }).toThrow('app_worker');
    expect(() => {
      assertConnectionRole('not a url', 'app_server');
    }).toThrow('not a valid connection URL');
    expect(() => {
      assertConnectionRole('postgres://app_server:pw@db/app', 'app_server');
    }).not.toThrow();
    // Supavisor pooler user names: <role>.<project-ref>
    expect(() => {
      assertConnectionRole('postgres://app_server.abcdef:pw@pooler:6543/postgres', 'app_server');
    }).not.toThrow();
    vi.stubEnv('DATABASE_URL_APP_SERVER', 'postgres://postgres@127.0.0.1:1/none');
    expect(() => getDatabase('app_server')).toThrow('must connect as login role app_server');
  });
});
