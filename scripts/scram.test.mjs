import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkPassword, scramSha256Verifier } from './lib/scram.mjs';

const PASSWORD = 'jadarat-test-password-0123456789-abcdef';
const SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

describe('scramSha256Verifier', () => {
  it('matches the verifier PostgreSQL accepts for login (vector verified against PostgreSQL 16)', () => {
    expect(scramSha256Verifier(PASSWORD, { salt: SALT })).toBe(
      'SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$NuaGmQlClX+Vmz2C+mMV7TZ9uwPBQKWwMjoUb2RH5m0=:80AES/AQ1VVFAUUs6gO2C/t/A9vKLyqZAQYpUtUkUmc=',
    );
  });

  it('uses a fresh random salt by default', () => {
    expect(scramSha256Verifier(PASSWORD)).not.toBe(scramSha256Verifier(PASSWORD));
  });

  it('never contains the password', () => {
    expect(scramSha256Verifier(PASSWORD)).not.toContain(PASSWORD);
  });

  it('rejects short, non-ASCII, whitespace or quoted passwords', () => {
    expect(checkPassword('')).toEqual(['is empty']);
    expect(checkPassword('short')).toContain('must be at least 32 characters');
    expect(checkPassword(`${PASSWORD} space`).length).toBeGreaterThan(0);
    expect(checkPassword(`${PASSWORD}é`).length).toBeGreaterThan(0);
    expect(checkPassword(`${PASSWORD}'`)).toContain('must not contain quotes or backslashes');
    expect(checkPassword(PASSWORD)).toEqual([]);
    expect(() => scramSha256Verifier('short')).toThrow(/at least 32/);
  });
});

describe('role-passwords-sql.mjs', () => {
  const run = (env) =>
    execFileSync(
      process.execPath,
      [new URL('./role-passwords-sql.mjs', import.meta.url).pathname],
      {
        env: { PATH: process.env.PATH, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).toString();

  it('prints one ALTER ROLE per provided password, with verifiers only', () => {
    const out = run({ APP_SERVER_DB_PASSWORD: PASSWORD, APP_WORKER_DB_PASSWORD: `${PASSWORD}-w` });
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^alter role app_server password 'SCRAM-SHA-256\$4096:[^']+';$/);
    expect(lines[1]).toMatch(/^alter role app_worker password 'SCRAM-SHA-256\$4096:[^']+';$/);
    expect(out).not.toContain(PASSWORD);
  });

  it('prints nothing when no password is provided', () => {
    expect(run({})).toBe('');
  });

  it('fails without printing SQL when a password is weak', () => {
    expect(() => run({ APP_SERVER_DB_PASSWORD: 'weak' })).toThrow();
  });
});
