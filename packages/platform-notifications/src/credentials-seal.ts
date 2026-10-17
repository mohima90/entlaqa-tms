import {
  type KeyObject,
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { EmailProviderId, EmailProviderInput } from './providers';

/**
 * Sealing e-mail provider secrets for the worker (WP-ADM-01; docs/engineering/email.md «Provider secrets»).
 *
 * The worker derives an X25519 key pair from its secret EMAIL_CREDENTIALS_KEY and publishes the PUBLIC key in
 * the database (private.email_credentials_key). The web app seals what a Super Admin or an Organization Admin
 * types with that public key — a sealed box: a fresh ephemeral X25519 key per secret, ECDH, HKDF-SHA256 over
 * the shared secret (salt: both public keys), AES-256-GCM with a random nonce and the scope (platform or the
 * organization, and the provider) as additional data — so a sealed value only opens in the worker, for the
 * scope it was sealed for. The web app holds no private key: it can write secrets, never read them back.
 *
 * Format: `v1.<key id>.<base64url(ephemeral public key ‖ nonce ‖ ciphertext ‖ tag)>`; the key id (base64url of
 * the first 9 bytes of SHA-256 over the public key) tells the worker — and the pages — whether the value was
 * sealed with its current key.
 */
export const SEALED_VERSION = 'v1';
export const SEALED_INFO = 'jadarat/email-credentials/v1';
const RAW_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const B64URL_KEY = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID = /^[A-Za-z0-9_-]{12}$/;

/** What the secrets belong to: bound into every sealed value (additional authenticated data). */
export type CredentialsScope =
  { readonly kind: 'platform' } | { readonly kind: 'tenant'; readonly tenantId: string };

/**
 * The additional data a sealed value is bound to: its owner and provider and, for SMTP, the server it was
 * typed for (`host:port`) — a saved SMTP password never opens for another server, so changing the host or the
 * port of the settings without typing the password again makes the worker refuse it (the database also
 * refuses to keep it, WP-ADM-01 security review).
 */
export function credentialsContext(
  scope: CredentialsScope,
  provider: EmailProviderId,
  options: unknown = {},
): string {
  const owner = scope.kind === 'platform' ? 'platform' : `tenant:${scope.tenantId.toLowerCase()}`;
  if (provider !== 'smtp') return `${SEALED_INFO}|${owner}|${provider}`;
  const record = (typeof options === 'object' && options !== null ? options : {}) as Record<
    string,
    unknown
  >;
  const host = typeof record.host === 'string' ? record.host.trim().toLowerCase() : '';
  const port =
    typeof record.port === 'number' || typeof record.port === 'string' ? String(record.port) : '';
  return `${SEALED_INFO}|${owner}|smtp|${host}:${port}`;
}

/** The key id of a raw 32-byte X25519 public key. */
export function credentialsKeyId(rawPublicKey: Uint8Array): string {
  return createHash('sha256').update(rawPublicKey).digest().subarray(0, 9).toString('base64url');
}

/** The public key the worker published (private.email_credentials_public_key()). */
export interface CredentialsPublicKey {
  readonly keyId: string;
  /** Raw X25519 public key, base64url without padding (43 characters). */
  readonly publicKey: string;
}

/** The key id inside a sealed value, or null when it is not one. */
export function sealedKeyId(sealed: string): string | null {
  const [version, keyId, payload] = sealed.split('.');
  return version === SEALED_VERSION && keyId !== undefined && KEY_ID.test(keyId) && payload
    ? keyId
    : null;
}

function x25519PublicKey(raw: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw }, format: 'jwk' });
}

/** The raw bytes of an X25519 public key object. */
export function rawPublicKey(key: KeyObject): Buffer {
  const { x } = key.export({ format: 'jwk' });
  if (typeof x !== 'string') throw new Error('not an X25519 public key');
  return Buffer.from(x, 'base64url');
}

/** The AES-256-GCM key of one sealed value (both sides derive the same). */
export function sealingKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), SEALED_INFO, 32),
  );
}

export const SEALED_LAYOUT = { RAW_KEY_BYTES, NONCE_BYTES, TAG_BYTES } as const;

/**
 * Seals `secrets` (a provider's secret fields) for the worker. Throws when the published key is malformed or
 * its id does not match it (a tampered row): nothing is written then.
 */
export function sealCredentials(
  key: CredentialsPublicKey,
  context: string,
  secrets: Readonly<Record<string, string>>,
): string {
  if (!B64URL_KEY.test(key.publicKey) || !KEY_ID.test(key.keyId)) {
    throw new Error('sealCredentials: malformed public key');
  }
  const recipientRaw = Buffer.from(key.publicKey, 'base64url');
  if (recipientRaw.length !== RAW_KEY_BYTES || credentialsKeyId(recipientRaw) !== key.keyId) {
    throw new Error('sealCredentials: the key id does not match the public key');
  }
  const recipient = x25519PublicKey(key.publicKey);
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralRaw = rawPublicKey(ephemeral.publicKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    sealingKey(shared, ephemeralRaw, recipientRaw),
    nonce,
  );
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(secrets), 'utf8')),
    cipher.final(),
  ]);
  const payload = Buffer.concat([ephemeralRaw, nonce, body, cipher.getAuthTag()]);
  return `${SEALED_VERSION}.${key.keyId}.${payload.toString('base64url')}`;
}

/**
 * The secrets typed on a settings page, sealed for the worker and bound to their scope and provider; null
 * when the field was left empty (keep the saved secrets — the database allows it for the same provider only).
 */
export function sealProviderInput(
  key: CredentialsPublicKey,
  scope: CredentialsScope,
  provider: EmailProviderInput,
): string | null {
  if (provider.secrets === null) return null;
  const secrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider.secrets)) secrets[name] = value;
  return sealCredentials(
    key,
    credentialsContext(scope, provider.provider, provider.options),
    secrets,
  );
}
