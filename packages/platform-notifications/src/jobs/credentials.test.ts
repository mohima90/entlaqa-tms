import { describe, expect, it } from 'vitest';
import {
  credentialsContext,
  credentialsKeyId,
  sealCredentials,
  sealedKeyId,
} from '../credentials-seal';
import { CredentialsError, deriveCredentialsKeyPair } from './credentials';

const SECRET = 'a-generated-64-character-secret-for-the-worker-tests-0123456789ab';
const TENANT_A = 'a0000000-0000-4000-8000-000000000001';
const TENANT_B = 'b0000000-0000-4000-8000-000000000001';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof CredentialsError ? error.code : 'OTHER';
  }
  return 'NONE';
};

describe('provider secrets: sealed by the web app, opened by the worker only', () => {
  const keys = deriveCredentialsKeyPair(SECRET);
  const contextA = credentialsContext({ kind: 'tenant', tenantId: TENANT_A }, 'resend');

  it('round trip: the worker opens what was sealed with its public key, for that scope', () => {
    const sealed = sealCredentials(keys.publicKey, contextA, { apiKey: 're_secret_value_123' });
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{60,}$/);
    expect(sealedKeyId(sealed)).toBe(keys.publicKey.keyId);
    expect(sealed).not.toContain('re_secret_value_123');
    expect(keys.open(sealed, contextA)).toEqual({ apiKey: 're_secret_value_123' });
    // Every seal is different (ephemeral key, random nonce).
    expect(sealCredentials(keys.publicKey, contextA, { apiKey: 're_secret_value_123' })).not.toBe(
      sealed,
    );
  });

  it('the same secret gives the same key pair on every worker; another secret another key', () => {
    expect(deriveCredentialsKeyPair(SECRET).publicKey).toEqual(keys.publicKey);
    const other = deriveCredentialsKeyPair(`${SECRET}-rotated`);
    expect(other.publicKey.keyId).not.toBe(keys.publicKey.keyId);
    expect(credentialsKeyId(Buffer.from(keys.publicKey.publicKey, 'base64url'))).toBe(
      keys.publicKey.keyId,
    );
    const sealed = sealCredentials(keys.publicKey, contextA, { apiKey: 're_secret_value_123' });
    expect(codeOf(() => other.open(sealed, contextA))).toBe('CREDENTIALS_KEY_CHANGED');
  });

  it('bound to its scope: another organization, the platform or another provider cannot open it', () => {
    const sealed = sealCredentials(keys.publicKey, contextA, { apiKey: 're_secret_value_123' });
    expect(
      codeOf(() =>
        keys.open(sealed, credentialsContext({ kind: 'tenant', tenantId: TENANT_B }, 'resend')),
      ),
    ).toBe('CREDENTIALS_INVALID');
    expect(
      codeOf(() => keys.open(sealed, credentialsContext({ kind: 'platform' }, 'resend'))),
    ).toBe('CREDENTIALS_INVALID');
    expect(
      codeOf(() =>
        keys.open(sealed, credentialsContext({ kind: 'tenant', tenantId: TENANT_A }, 'sendgrid')),
      ),
    ).toBe('CREDENTIALS_INVALID');
  });

  it('an SMTP password is bound to its server: another host or port cannot open it (security review)', () => {
    const scope = { kind: 'tenant', tenantId: TENANT_A } as const;
    const relay = { host: 'smtp.raya.example', port: 587, security: 'starttls', username: 'u' };
    const sealed = sealCredentials(keys.publicKey, credentialsContext(scope, 'smtp', relay), {
      password: 'p w',
    });
    expect(
      keys.open(sealed, credentialsContext(scope, 'smtp', { ...relay, host: 'SMTP.raya.example' })),
    ).toEqual({
      password: 'p w',
    });
    expect(
      codeOf(() =>
        keys.open(sealed, credentialsContext(scope, 'smtp', { ...relay, host: 'evil.example' })),
      ),
    ).toBe('CREDENTIALS_INVALID');
    expect(
      codeOf(() => keys.open(sealed, credentialsContext(scope, 'smtp', { ...relay, port: 2525 }))),
    ).toBe('CREDENTIALS_INVALID');
  });

  it('tampered or foreign values are refused without saying more', () => {
    const sealed = sealCredentials(keys.publicKey, contextA, { apiKey: 're_secret_value_123' });
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}${sealed.slice(-1)}`;
    expect(codeOf(() => keys.open(flipped, contextA))).toBe('CREDENTIALS_INVALID');
    expect(codeOf(() => keys.open('re_plain_key', contextA))).toBe('CREDENTIALS_INVALID');
    expect(codeOf(() => keys.open(`v1.${keys.publicKey.keyId}.short`, contextA))).toBe(
      'CREDENTIALS_INVALID',
    );
    const error = (() => {
      try {
        keys.open(flipped, contextA);
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(error?.message).toBe('e-mail provider secrets not usable (CREDENTIALS_INVALID)');
    expect(String(error?.stack)).not.toContain('re_secret_value_123');
  });

  it('refuses a short worker secret, naming the variable and never the value', () => {
    expect(() => deriveCredentialsKeyPair('too-short-secret')).toThrow(
      'EMAIL_CREDENTIALS_KEY must be at least 32 characters',
    );
    try {
      deriveCredentialsKeyPair('too-short-secret');
    } catch (error) {
      expect(String(error)).not.toContain('too-short-secret');
    }
  });

  it('sealing refuses a malformed or mismatched published key (a tampered row)', () => {
    expect(() =>
      sealCredentials({ keyId: 'short', publicKey: keys.publicKey.publicKey }, contextA, {}),
    ).toThrow('malformed public key');
    expect(() =>
      sealCredentials({ keyId: 'AAAAAAAAAAAA', publicKey: keys.publicKey.publicKey }, contextA, {}),
    ).toThrow('does not match');
  });
});
