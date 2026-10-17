import {
  type KeyObject,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from 'node:crypto';
import {
  type CredentialsPublicKey,
  SEALED_LAYOUT,
  SEALED_VERSION,
  credentialsKeyId,
  rawPublicKey,
  sealedKeyId,
  sealingKey,
} from '../credentials-seal';

/** The worker's secret (environment): EMAIL_CREDENTIALS_KEY. */
export const EMAIL_CREDENTIALS_KEY_ENV = 'EMAIL_CREDENTIALS_KEY';
/** At least 32 characters (e.g. a generated 64-character password): the key pair is derived from it. */
export const EMAIL_CREDENTIALS_KEY_MIN_LENGTH = 32;

/**
 * A sealed value could not be opened. `code`: CREDENTIALS_KEY_MISSING (the worker has no key),
 * CREDENTIALS_KEY_CHANGED (sealed with another key: enter the secrets again), CREDENTIALS_INVALID (tampered,
 * another scope, or not a value of ours). The message names the code only — never the value.
 */
export class CredentialsError extends Error {
  override readonly name = 'CredentialsError';
  constructor(
    readonly code: 'CREDENTIALS_KEY_MISSING' | 'CREDENTIALS_KEY_CHANGED' | 'CREDENTIALS_INVALID',
  ) {
    super(`e-mail provider secrets not usable (${code})`);
  }
}

/** The worker's key pair: what it publishes, and opening what the web app sealed. */
export interface CredentialsKeyPair {
  readonly publicKey: CredentialsPublicKey;
  /** The secrets inside a sealed value of `context`; throws CredentialsError. */
  open(sealed: string, context: string): Record<string, unknown>;
}

// PKCS #8 prefix of a raw 32-byte X25519 private key (RFC 8410).
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

/**
 * Derives the worker's X25519 key pair from its secret (HKDF-SHA256): the same secret always gives the same
 * pair, so every worker of an installation opens what was sealed for any of them, and a new secret is a new
 * key (the settings pages then ask for the secrets again). Throws (naming the variable, never the value) when
 * the secret is too short.
 */
export function deriveCredentialsKeyPair(secret: string): CredentialsKeyPair {
  if (secret.length < EMAIL_CREDENTIALS_KEY_MIN_LENGTH) {
    throw new Error(
      `${EMAIL_CREDENTIALS_KEY_ENV} must be at least ${String(EMAIL_CREDENTIALS_KEY_MIN_LENGTH)} characters`,
    );
  }
  const seed = Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), 'jadarat/email-credentials/x25519', 'v1', 32),
  );
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const ownRaw = rawPublicKey(createPublicKey(privateKey));
  const keyId = credentialsKeyId(ownRaw);
  const { RAW_KEY_BYTES, NONCE_BYTES, TAG_BYTES } = SEALED_LAYOUT;
  return {
    publicKey: { keyId, publicKey: ownRaw.toString('base64url') },
    open(sealed, context) {
      const sealedId = sealedKeyId(sealed);
      if (sealedId === null) throw new CredentialsError('CREDENTIALS_INVALID');
      if (sealedId !== keyId) throw new CredentialsError('CREDENTIALS_KEY_CHANGED');
      const payload = Buffer.from(sealed.slice(`${SEALED_VERSION}.${keyId}.`.length), 'base64url');
      if (payload.length < RAW_KEY_BYTES + NONCE_BYTES + TAG_BYTES + 2) {
        throw new CredentialsError('CREDENTIALS_INVALID');
      }
      const ephemeralRaw = payload.subarray(0, RAW_KEY_BYTES);
      const nonce = payload.subarray(RAW_KEY_BYTES, RAW_KEY_BYTES + NONCE_BYTES);
      const body = payload.subarray(RAW_KEY_BYTES + NONCE_BYTES, payload.length - TAG_BYTES);
      const tag = payload.subarray(payload.length - TAG_BYTES);
      try {
        const ephemeral = createPublicKey({
          key: { kty: 'OKP', crv: 'X25519', x: ephemeralRaw.toString('base64url') },
          format: 'jwk',
        });
        const shared = diffieHellman({ privateKey, publicKey: ephemeral });
        const decipher = createDecipheriv(
          'aes-256-gcm',
          sealingKey(shared, ephemeralRaw, ownRaw),
          nonce,
        );
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
        const value: unknown = JSON.parse(plain);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('not an object');
        }
        return value as Record<string, unknown>;
      } catch {
        throw new CredentialsError('CREDENTIALS_INVALID');
      }
    },
  };
}
