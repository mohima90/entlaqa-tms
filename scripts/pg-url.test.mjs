import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDatabaseUrl, pgpassLine } from './lib/pg-url.mjs';

const SECRET = 'S3cr3t:pa\\ss@word#%';
const encoded = encodeURIComponent(SECRET);
const URL_OK = `postgresql://postgres.abcdefghijklmnopqrst:${encoded}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

describe('parseDatabaseUrl', () => {
  it('splits a Supabase session-pooler URL into libpq parts', () => {
    const c = parseDatabaseUrl(URL_OK);
    expect(c).toMatchObject({
      host: 'aws-0-eu-central-1.pooler.supabase.com',
      port: '5432',
      user: 'postgres.abcdefghijklmnopqrst',
      database: 'postgres',
      password: SECRET,
      isLocal: false,
    });
    expect(c.passwordForms).toEqual([SECRET, encoded]);
  });

  it('defaults port 5432 and database postgres; recognises local hosts', () => {
    const c = parseDatabaseUrl('postgres://postgres:x@127.0.0.1');
    expect(c).toMatchObject({ port: '5432', database: 'postgres', isLocal: true });
  });

  it.each([
    ['not a URL', 'not a url'],
    ['wrong scheme', 'mysql://u:p@h/db'],
    ['query parameters (TLS is set by the script)', `${URL_OK}?sslmode=disable`],
    ['no password', 'postgresql://postgres@db.example.com/postgres'],
    ['bad percent-encoding', 'postgresql://postgres:s3cr%zzETpass@db.example.com/postgres'],
    ['unencoded # in the password', 'postgresql://postgres:pa@ss#word@db.example.com/postgres'],
  ])('rejects %s without echoing the URL', (_label, url) => {
    let message = '';
    try {
      parseDatabaseUrl(url);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/^DATABASE_URL /);
    for (const fragment of ['s3cr', 'ss#word', 'zzET', 'example.com', 'pooler']) {
      expect(message).not.toContain(fragment);
    }
  });
});

describe('pgpassLine', () => {
  it('escapes ":" and "\\" in every field', () => {
    expect(
      pgpassLine({ host: 'h', port: '5432', database: 'd', user: 'u', password: 'a:b\\c' }),
    ).toBe('h:5432:d:u:a\\:b\\\\c');
  });
});

describe('pg-connection.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jadarat-pgconn-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = new URL('./pg-connection.mjs', import.meta.url).pathname;
  const run = (env) =>
    execFileSync(process.execPath, [script, join(dir, 'pgpass'), join(dir, 'conn.env')], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();

  it('writes a 0600 pgpass file and non-secret parts; masks the password in GitHub Actions', () => {
    const out = run({ DATABASE_URL: URL_OK, GITHUB_ACTIONS: 'true' });
    expect(out).toBe(`::add-mask::${SECRET}\n::add-mask::${encoded}\n`);
    expect(statSync(join(dir, 'pgpass')).mode & 0o777).toBe(0o600);
    const env = readFileSync(join(dir, 'conn.env'), 'utf8');
    expect(env).toContain('PGHOST=aws-0-eu-central-1.pooler.supabase.com\n');
    expect(env).toContain('DB_IS_LOCAL=0\n');
    expect(env).not.toContain('S3cr3t');
  });

  it('prints nothing outside GitHub Actions and fails generically on a bad URL', () => {
    expect(run({ DATABASE_URL: URL_OK })).toBe('');
    let stderr = '';
    try {
      run({ DATABASE_URL: 'postgresql://postgres:s3cr%zzETpass@db.example.com/postgres' });
    } catch (error) {
      stderr = error.stderr.toString();
    }
    expect(stderr).toContain('DATABASE_URL');
    expect(stderr).not.toContain('s3cr');
  });
});
