import { describe, expect, it } from 'vitest';
import {
  generateSignInCode,
  hookSecretBytes,
  openTokenHash,
  sealTokenHash,
} from './sign-in-code-seal';

const KEY = Buffer.from('a-hook-secret-with-thirty-two-bytes!!', 'utf8');
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const USER = '9d406f51-7e80-4192-9dae-2f3a4b5c6d7e';
const OTHER = '11111111-2222-4333-8444-555555555555';
const HASH = '0123456789abcdef'.repeat(4);

describe('our sign-in code', () => {
  it('is six random digits, leading zeros kept', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = generateSignInCode();
      expect(code).toMatch(/^[0-9]{6}$/);
      seen.add(code);
    }
    // Random, not constant (200 draws from a million values).
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("Auth's token hash, sealed for the database", () => {
  it('comes back for the same account and secret, and is not readable in the sealed text', () => {
    const sealed = sealTokenHash(SECRET, USER, HASH);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain(HASH);
    expect(openTokenHash(SECRET, USER, sealed ?? '')).toBe(HASH);
    // Accepted in the other spellings of the same secret.
    expect(openTokenHash(KEY.toString('base64'), USER, sealed ?? '')).toBe(HASH);
    expect(openTokenHash(`whsec_${KEY.toString('base64')}`, USER, sealed ?? '')).toBe(HASH);
  });

  it('is different every time (a fresh nonce)', () => {
    expect(sealTokenHash(SECRET, USER, HASH)).not.toBe(sealTokenHash(SECRET, USER, HASH));
  });

  it("is bound to its account: another account's row cannot be redeemed", () => {
    const sealed = sealTokenHash(SECRET, USER, HASH) ?? '';
    expect(openTokenHash(SECRET, OTHER, sealed)).toBeNull();
    expect(openTokenHash(SECRET, USER.toUpperCase(), sealed)).toBe(HASH);
  });

  it('cannot be opened with another secret (a rotated hook secret ends the codes in flight)', () => {
    const sealed = sealTokenHash(SECRET, USER, HASH) ?? '';
    const another = `v1,whsec_${Buffer.from('another-secret-another-secret-123').toString('base64')}`;
    expect(openTokenHash(another, USER, sealed)).toBeNull();
  });

  it('refuses anything that is not exactly what was sealed', () => {
    const sealed = sealTokenHash(SECRET, USER, HASH) ?? '';
    const [version, iv, ciphertext, tag] = sealed.split('.') as [string, string, string, string];
    const flipped = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;
    for (const bad of [
      '',
      'v1',
      `${version}.${iv}.${ciphertext}`,
      `${version}.${iv}.${ciphertext}.${tag}.extra`,
      `v2.${iv}.${ciphertext}.${tag}`,
      `${version}.${iv}.${flipped}.${tag}`,
      `${version}.${iv}.${ciphertext}.${tag.slice(0, -4)}`,
      `${version}.${iv.slice(0, -4)}.${ciphertext}.${tag}`,
      HASH,
    ]) {
      expect(openTokenHash(SECRET, USER, bad)).toBeNull();
    }
  });

  it('no usable secret: nothing is sealed or opened', () => {
    expect(sealTokenHash('', USER, HASH)).toBeNull();
    expect(sealTokenHash('v1,whsec_', USER, HASH)).toBeNull();
    expect(openTokenHash('', USER, 'v1.a.b.c')).toBeNull();
    expect(hookSecretBytes('v1,whsec_').length).toBe(0);
  });
});
