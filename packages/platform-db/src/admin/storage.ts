import 'server-only';

/**
 * Supabase Storage with the WORKER's secret key (T-M2-18, ADR 0006 §3.4, ADR 0002 §7): reading uploaded
 * objects for the type check and malware scan, moving infected objects to quarantine, removing objects by
 * retention, storing generated files. The same key as the Auth admin API (SUPABASE_URL +
 * SUPABASE_SECRET_KEY: hosted Supabase's secret key, or the self-hosted worker's service_role token, which
 * the gateway serves on the internal admin port only) — in the worker's environment only, never the web
 * app's. Plain HTTP calls (no client library): bodies are streamed, never buffered whole, and every call
 * has a time limit.
 */
export interface StorageAdminSettings {
  readonly url: string;
  readonly secretKey: string;
}

/** Storage refused or could not answer; `temporary`: worth another attempt. Never Storage's message. */
export class StorageAdminError extends Error {
  override readonly name = 'StorageAdminError';
  constructor(
    readonly code: string,
    readonly temporary: boolean,
  ) {
    super(`Storage admin request failed (${code})`);
  }
}

export interface StoredObject {
  readonly body: ReadableStream<Uint8Array>;
  /** Content-Length when Storage sent one. */
  readonly size: number | null;
}

export interface StorageAdmin {
  /** The object's bytes as a stream; null when it does not exist. */
  read(bucket: string, key: string, signal?: AbortSignal): Promise<StoredObject | null>;
  /** Moves an object to another bucket under the same key; `missing` when the source is gone. */
  move(bucket: string, key: string, toBucket: string): Promise<'moved' | 'missing'>;
  /** Removes an object; removing a missing object is not an error. */
  remove(bucket: string, key: string): Promise<void>;
  /** Stores bytes produced by a job (generated files); never replaces an existing object. */
  write(
    bucket: string,
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
  ): Promise<void>;
}

/** Calls that change something: abandoned after this long (and retried later). */
export const STORAGE_ADMIN_TIMEOUT_MS = 30_000;
/** Reading an object (up to 200 MB) to scan it. */
export const STORAGE_READ_TIMEOUT_MS = 10 * 60_000;

const KEY = /^[0-9a-f-]{36}(\/[a-z0-9_-]{1,64}){2}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const BUCKET = /^[a-z][a-z0-9-]{1,62}$/;

function check(bucket: string, key: string): void {
  if (!BUCKET.test(bucket) || !KEY.test(key))
    throw new StorageAdminError('INVALID_OBJECT_KEY', false);
}

function failure(status: number): StorageAdminError {
  if (status === 401 || status === 403) return new StorageAdminError('STORAGE_ADMIN_KEY', true);
  if (status === 429 || status >= 500)
    return new StorageAdminError(`STORAGE_HTTP_${String(status)}`, true);
  return new StorageAdminError(`STORAGE_HTTP_${String(status)}`, false);
}

/** Storage answers a missing object with 404, or 400 carrying statusCode "404" / error "not_found". */
async function isMissing(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const body = (await response.json()) as { statusCode?: unknown; error?: unknown };
    return String(body.statusCode) === '404' || body.error === 'not_found';
  } catch {
    return false;
  }
}

export function createStorageAdmin(
  settings: StorageAdminSettings,
  fetchImpl: typeof fetch = fetch,
): StorageAdmin {
  const base = `${settings.url.replace(/\/+$/, '')}/storage/v1`;
  const headers = { apikey: settings.secretKey, authorization: `Bearer ${settings.secretKey}` };
  const path = (bucket: string, key: string) => `${encodeURIComponent(bucket)}/${key}`;

  async function call(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await fetchImpl(input, { ...init, signal, redirect: 'error' });
    } catch {
      throw new StorageAdminError('STORAGE_UNREACHABLE', true);
    }
  }

  return {
    async read(bucket, key, signal) {
      check(bucket, key);
      const response = await call(
        `${base}/object/authenticated/${path(bucket, key)}`,
        { method: 'GET', headers, ...(signal ? { signal } : {}) },
        STORAGE_READ_TIMEOUT_MS,
      );
      if (!response.ok) {
        if (await isMissing(response)) return null;
        throw failure(response.status);
      }
      if (!response.body) throw new StorageAdminError('STORAGE_NO_BODY', true);
      const header = response.headers.get('content-length');
      const length = header === null || header === '' ? Number.NaN : Number(header);
      return {
        body: response.body,
        size: Number.isSafeInteger(length) && length >= 0 ? length : null,
      };
    },
    async move(bucket, key, toBucket) {
      check(bucket, key);
      check(toBucket, key);
      const response = await call(
        `${base}/object/move`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            bucketId: bucket,
            sourceKey: key,
            destinationBucket: toBucket,
            destinationKey: key,
          }),
        },
        STORAGE_ADMIN_TIMEOUT_MS,
      );
      if (response.ok) return 'moved';
      if (await isMissing(response)) return 'missing';
      throw failure(response.status);
    },
    async remove(bucket, key) {
      check(bucket, key);
      const response = await call(
        `${base}/object/${path(bucket, key)}`,
        { method: 'DELETE', headers },
        STORAGE_ADMIN_TIMEOUT_MS,
      );
      if (response.ok || (await isMissing(response))) return;
      throw failure(response.status);
    },
    async write(bucket, key, bytes, contentType) {
      check(bucket, key);
      const response = await call(
        `${base}/object/${path(bucket, key)}`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': contentType, 'x-upsert': 'false' },
          body: bytes,
        },
        STORAGE_ADMIN_TIMEOUT_MS,
      );
      if (!response.ok) throw failure(response.status);
    },
  };
}
