import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomInt } from 'node:crypto';

/**
 * The two secrets of an e-mailed sign-in code that the web tier handles itself (WP-ADM-05, security re-review H1):
 *
 *  - OUR six-digit code, generated here from the platform's random source - not Auth's (Auth's one-time
 *    password is long and is never e-mailed, so there is nothing short for anyone to guess against Auth's
 *    public /verify);
 *  - Auth's `token_hash` of the same sign-in, which only the right code redeems (`verifyOtp({ token_hash })`).
 *    It is stored in the database ENCRYPTED (AES-256-GCM) with a key derived (HKDF-SHA-256) from the Send Email
 *    hook secret, which the database never sees, and bound to the account: a copy of the table, a backup or a
 *    read-only SQL leak is not a way into any account. Rotating the hook secret simply makes the (at most ten
 *    minutes old) codes in flight unusable.
 */

/** The key bytes of the hook secret as Supabase shows it: `v1,whsec_<base64>` / `whsec_<base64>` / `<base64>`. */
export function hookSecretBytes(secret: string): Buffer {
  const trimmed = secret.trim();
  const withoutVersion = trimmed.startsWith('v1,') ? trimmed.slice(3) : trimmed;
  const base64 = withoutVersion.startsWith('whsec_') ? withoutVersion.slice(6) : withoutVersion;
  return Buffer.from(base64, 'base64');
}

const INFO = 'jadarat.sign-in-code.token-hash.v1';
const VERSION = 'v1';

/** Six random digits (leading zeros kept), from a cryptographic source. */
export function generateSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function keyFor(secret: string): Buffer | null {
  const bytes = hookSecretBytes(secret);
  if (bytes.length === 0) return null;
  return Buffer.from(hkdfSync('sha256', bytes, Buffer.alloc(0), INFO, 32));
}

const aad = (userId: string) => Buffer.from(`sign-in-code:${userId.toLowerCase()}`, 'utf8');

/** Auth's token hash as it can be stored: `v1.<iv>.<ciphertext>.<tag>` (base64url). Null: no usable secret. */
export function sealTokenHash(secret: string, userId: string, tokenHash: string): string | null {
  const key = keyFor(secret);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(tokenHash, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

/** The token hash again; null for anything that is not exactly what `sealTokenHash` made for this account. */
export function openTokenHash(secret: string, userId: string, sealed: string): string | null {
  const key = keyFor(secret);
  if (!key) return null;
  const [version, iv, ciphertext, tag, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !ciphertext || !tag || rest.length > 0) return null;
  try {
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    if (ivBytes.length !== 12 || tagBytes.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, ivBytes);
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
