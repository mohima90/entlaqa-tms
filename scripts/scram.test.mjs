import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkPassword, scramSha256Verifier, stableSalt } from './lib/scram.mjs';

const PASSWORD = 'jadarat-test-password-0123456789-abcdefghij';
const SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

describe('scramSha256Verifier', () => {
  it('matches the verifier PostgreSQL accepts for login (vector verified against PostgreSQL 16)', () => {
    expect(scramSha256Verifier(PASSWORD, { salt: SALT })).toBe(
      'SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$tFkRG4Y1pdEx/E8DZz9Yj6eY5O583SopYyf063MuYvg=:cmGDil3g4AJv/GEBPzki+Bc+2/lV1FxOqbLDhhh3JUI=',
    );
  });

  it('uses a fresh random salt by default', () => {
    expect(scramSha256Verifier(PASSWORD)).not.toBe(scramSha256Verifier(PASSWORD));
  });

  it('stable salt: same role and password give the same verifier; another role or password does not', () => {
    const salt = stableSalt('app_queue', PASSWORD);
    expect(salt).toHaveLength(16);
    expect(stableSalt('app_queue', PASSWORD).equals(salt)).toBe(true);
    expect(stableSalt('app_worker', PASSWORD).equals(salt)).toBe(false);
    expect(stableSalt('app_queue', `${PASSWORD}-x`).equals(salt)).toBe(false);
    expect(salt.toString('utf8')).not.toContain(PASSWORD.slice(0, 8));
  });

  it('never contains the password', () => {
    expect(scramSha256Verifier(PASSWORD)).not.toContain(PASSWORD);
  });

  it('accepts only URL-safe passwords of at least 40 characters', () => {
    expect(checkPassword('')).toEqual(['is empty']);
    expect(checkPassword('short')).toContain('must be at least 40 characters');
    for (const bad of [' ', 'é', "'", '"', '\\', '@', '/', ':', '#', '?', '%', '+']) {
      expect(checkPassword(`${PASSWORD}${bad}`)).toContain(
        'must contain only letters, digits, "-" and "_"',
      );
    }
    expect(checkPassword(PASSWORD)).toEqual([]);
    expect(checkPassword('A_b-9'.repeat(8))).toEqual([]);
    expect(() => scramSha256Verifier('short')).toThrow(/at least 40/);
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

  it('prints the same verifier on every run for an unchanged password (no pooler cache churn)', () => {
    const env = { APP_QUEUE_DB_PASSWORD: PASSWORD };
    expect(run(env)).toBe(run(env));
  });

  it('prints nothing when no password is provided', () => {
    expect(run({})).toBe('');
  });

  it('fails without printing SQL when a password is weak', () => {
    expect(() => run({ APP_SERVER_DB_PASSWORD: 'weak' })).toThrow();
  });
});
