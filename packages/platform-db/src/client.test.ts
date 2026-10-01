import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertConnectionRole,
  createDatabase,
  getDatabase,
  isDatabaseConfigured,
  tlsOptionsFor,
} from './client';

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

const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('database TLS (verify-full for remote hosts)', () => {
  it('verifies remote servers against the configured root CA', () => {
    expect(
      tlsOptionsFor(
        'postgres://app_server.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
        CA,
      ),
    ).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it('fails closed for a remote host without a CA, even if the URL asks for sslmode=disable', () => {
    expect(() =>
      tlsOptionsFor('postgres://app_server:pw@db.example.com/app?sslmode=disable', undefined),
    ).toThrow('DATABASE_CA_CERT');
    expect(() => tlsOptionsFor('postgres://app_server:pw@db.example.com/app', 'not a pem')).toThrow(
      'DATABASE_CA_CERT',
    );
    expect(() => createDatabase('postgres://app_server:pw@db.example.com/app')).toThrow(
      'DATABASE_CA_CERT',
    );
  });

  it('leaves local servers (development, CI) to the URL', () => {
    expect(tlsOptionsFor('postgres://app_server@127.0.0.1:5432/app', undefined)).toBeUndefined();
    expect(tlsOptionsFor('postgres://app_server@localhost/app', undefined)).toBeUndefined();
    expect(() => tlsOptionsFor('not a url', CA)).toThrow('not a valid connection URL');
  });

  it('passes the CA from DATABASE_CA_CERT to remote role connections', () => {
    // app_server: not cached by the earlier tests (their getDatabase calls threw before caching).
    vi.stubEnv(
      'DATABASE_URL_APP_SERVER',
      'postgres://app_server.ref:pw@pooler.example.com:6543/postgres',
    );
    vi.stubEnv('DATABASE_CA_CERT', '');
    expect(() => getDatabase('app_server')).toThrow('DATABASE_CA_CERT');
  });
});
