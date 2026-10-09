import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from '../env';

/**
 * Supabase Storage with the signed-in user's OWN session (T-M2-18, ADR 0006 §3–§5): the web app never
 * holds a Storage service key. Storage evaluates our storage.objects policies with the user's JWT:
 *  - a signed upload URL is created only for the key of the user's own pending upload (INSERT policy);
 *  - a signed download URL only for a clean file with an unexpired download grant for the user (SELECT).
 * The URLs themselves are then valid without a session for their lifetime (upload: Storage's
 * UPLOAD_SIGNED_URL_EXPIRATION_TIME — 2 hours on hosted Supabase, 15 minutes self-hosted; download: the
 * grant's TTL), each for exactly one key.
 */
export interface UserFileStorage {
  createSignedUploadUrl(bucket: string, objectKey: string): Promise<SignedUpload>;
  createSignedDownloadUrl(
    bucket: string,
    objectKey: string,
    ttlSeconds: number,
    downloadName: string,
  ): Promise<string>;
}

export interface SignedUpload {
  /** Absolute URL for the browser's PUT (public Storage origin, see STORAGE_PUBLIC_URL). */
  readonly url: string;
  readonly token: string;
}

/**
 * Storage refused or could not answer. `forbidden`: the policies refused (no pending upload, no grant,
 * another tenant); `temporary`: unreachable or failing — worth another attempt. Never Storage's message.
 */
export class FileStorageError extends Error {
  override readonly name = 'FileStorageError';
  constructor(
    readonly code:
      'STORAGE_FORBIDDEN' | 'STORAGE_NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'STORAGE_ERROR',
    readonly temporary: boolean,
  ) {
    super(`Storage request failed (${code})`);
  }
}

/**
 * Storage's error: `status` is the HTTP status, `statusCode` Storage's own code (e.g. HTTP 400 with
 * statusCode "403" for an RLS refusal, "404" when the policies hide the object).
 */
export function storageErrorOf(error: unknown): FileStorageError {
  const fields = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  const http = Number(fields.status);
  const code = Number(fields.statusCode);
  if (code === 404 || http === 404) return new FileStorageError('STORAGE_NOT_FOUND', false);
  if (code === 401 || code === 403 || http === 401 || http === 403 || http === 400) {
    return new FileStorageError('STORAGE_FORBIDDEN', false);
  }
  if (!Number.isFinite(http) || http === 429 || http >= 500) {
    return new FileStorageError('STORAGE_UNAVAILABLE', true);
  }
  return new FileStorageError('STORAGE_ERROR', false);
}

/** STORAGE_PUBLIC_URL: the Storage origin browsers use, when the app reaches Supabase by an internal name. */
export const STORAGE_PUBLIC_URL_ENV = 'STORAGE_PUBLIC_URL';

/**
 * The browser-facing origin for signed URLs. Hosted Supabase: unset (the app and browsers use the same
 * project URL). Self-hosted: the app reaches the gateway as https://gateway:8443 while browsers use the
 * installation's public name — STORAGE_PUBLIC_URL (an https origin; http only for localhost).
 */
export function readStoragePublicOrigin(
  value: string | undefined = readEnv(STORAGE_PUBLIC_URL_ENV),
): string | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${STORAGE_PUBLIC_URL_ENV} is not a valid URL`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`${STORAGE_PUBLIC_URL_ENV} must be an https origin without path or query`);
  }
  return url.origin;
}

/** Replaces the origin of a Storage URL with the public one (path and query unchanged). */
export function toPublicUrl(raw: string, publicOrigin: string | null): string {
  if (publicOrigin === null) return raw;
  const url = new URL(raw);
  const target = new URL(publicOrigin);
  url.protocol = target.protocol;
  url.host = target.host;
  return url.toString();
}

/**
 * Storage through the user's server-side Supabase client (createSupabaseServerClient: publishable key +
 * the user's session cookies).
 */
export function createUserFileStorage(
  client: SupabaseClient,
  publicOrigin: string | null = readStoragePublicOrigin(),
): UserFileStorage {
  return {
    async createSignedUploadUrl(bucket, objectKey) {
      let answer: Awaited<
        ReturnType<ReturnType<typeof client.storage.from>['createSignedUploadUrl']>
      >;
      try {
        // No upsert: an object, once uploaded, is never replaced (ADR 0006 §2).
        answer = await client.storage.from(bucket).createSignedUploadUrl(objectKey);
      } catch {
        throw new FileStorageError('STORAGE_UNAVAILABLE', true);
      }
      if (answer.error) throw storageErrorOf(answer.error);
      return { url: toPublicUrl(answer.data.signedUrl, publicOrigin), token: answer.data.token };
    },
    async createSignedDownloadUrl(bucket, objectKey, ttlSeconds, downloadName) {
      let answer: Awaited<ReturnType<ReturnType<typeof client.storage.from>['createSignedUrl']>>;
      try {
        answer = await client.storage.from(bucket).createSignedUrl(objectKey, ttlSeconds);
      } catch {
        throw new FileStorageError('STORAGE_UNAVAILABLE', true);
      }
      if (answer.error) throw storageErrorOf(answer.error);
      // `download` set here (one encoding): Storage answers Content-Disposition: attachment with the
      // name as RFC 5987 `filename*`, so Arabic names survive (supabase-js would encode it twice).
      const url = new URL(answer.data.signedUrl);
      url.searchParams.set('download', downloadName);
      return toPublicUrl(url.toString(), publicOrigin);
    },
  };
}
