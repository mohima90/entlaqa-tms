import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { runWithClaims } from '../claims-tx';
import type { AppDatabase } from '../client';
import {
  FileStorageError,
  STORAGE_STRIPPED_HEADERS,
  createUserFileStorage,
  readStorageInternalOrigin,
  readStoragePublicOrigin,
  storageErrorOf,
  storageRoutingFetch,
  toPublicUrl,
} from './storage';

describe('storageErrorOf', () => {
  it('classifies Storage errors without keeping their message', () => {
    expect(storageErrorOf({ status: 400, statusCode: '403' }).code).toBe('STORAGE_FORBIDDEN');
    expect(storageErrorOf({ status: 400, statusCode: '404' }).code).toBe('STORAGE_NOT_FOUND');
    expect(storageErrorOf({ status: 404 }).code).toBe('STORAGE_NOT_FOUND');
    expect(storageErrorOf({ status: 401 }).code).toBe('STORAGE_FORBIDDEN');
    expect(storageErrorOf({ status: 400 }).code).toBe('STORAGE_FORBIDDEN');
    const down = storageErrorOf({ status: 503 });
    expect(down.code).toBe('STORAGE_UNAVAILABLE');
    expect(down.temporary).toBe(true);
    expect(storageErrorOf({ status: 429 }).temporary).toBe(true);
    expect(storageErrorOf(new Error('network')).code).toBe('STORAGE_UNAVAILABLE');
    expect(storageErrorOf(null).code).toBe('STORAGE_UNAVAILABLE');
    expect(storageErrorOf({ status: 409, message: 'secret detail' }).code).toBe('STORAGE_ERROR');
    expect(storageErrorOf({ status: 409, message: 'secret detail' }).message).not.toContain(
      'secret',
    );
  });
});

describe('readStoragePublicOrigin and toPublicUrl', () => {
  it('accepts an https origin (http only for localhost)', () => {
    expect(readStoragePublicOrigin(undefined)).toBeNull();
    expect(readStoragePublicOrigin('https://tms.customer.example')).toBe(
      'https://tms.customer.example',
    );
    expect(readStoragePublicOrigin('https://localhost:8443/')).toBe('https://localhost:8443');
    expect(readStoragePublicOrigin('http://localhost:8443')).toBe('http://localhost:8443');
  });

  it('refuses anything else', () => {
    for (const value of [
      'not a url',
      'http://tms.customer.example',
      'https://tms.customer.example/storage',
      'https://user:pw@tms.customer.example',
      'https://tms.customer.example?x=1',
      'https://tms.customer.example#x',
      'ftp://localhost',
    ]) {
      expect(() => readStoragePublicOrigin(value)).toThrow('STORAGE_PUBLIC_URL');
    }
  });

  it('replaces the origin only', () => {
    expect(
      toPublicUrl(
        'https://gateway:8443/storage/v1/object/upload/sign/imports/a/b?token=t',
        'https://tms.customer.example',
      ),
    ).toBe('https://tms.customer.example/storage/v1/object/upload/sign/imports/a/b?token=t');
    expect(toPublicUrl('https://x.supabase.co/a?token=t', null)).toBe(
      'https://x.supabase.co/a?token=t',
    );
  });
});

describe('readStorageInternalOrigin and storageRoutingFetch (security review M2)', () => {
  it('reads the internal origin like the public one', () => {
    expect(readStorageInternalOrigin(undefined)).toBeNull();
    expect(readStorageInternalOrigin('https://gateway:8445')).toBe('https://gateway:8445');
    expect(() => readStorageInternalOrigin('http://gateway:8445')).toThrow('STORAGE_INTERNAL_URL');
    expect(() => readStorageInternalOrigin('https://gateway:8445/storage')).toThrow(
      'STORAGE_INTERNAL_URL',
    );
  });

  it('sends Storage calls (only) to the internal origin, path and query unchanged', async () => {
    const seen: string[] = [];
    const base = ((input: RequestInfo | URL) => {
      seen.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const routed = storageRoutingFetch('https://gateway:8445', base);
    await routed('https://gateway:8443/storage/v1/object/upload/sign/imports/a/b', {
      method: 'POST',
    });
    await routed(new URL('https://gateway:8443/storage/v1/object/sign/imports/a/b?x=1'));
    await routed(
      new Request('https://gateway:8443/storage/v1/object/sign/imports/c', { method: 'POST' }),
    );
    await routed('https://gateway:8443/auth/v1/token?grant_type=refresh_token', { method: 'POST' });
    await routed('https://gateway:8443/storagex/v1/object');
    expect(seen).toEqual([
      'https://gateway:8445/storage/v1/object/upload/sign/imports/a/b',
      'https://gateway:8445/storage/v1/object/sign/imports/a/b?x=1',
      'https://gateway:8445/storage/v1/object/sign/imports/c',
      'https://gateway:8443/auth/v1/token?grant_type=refresh_token',
      'https://gateway:8443/storagex/v1/object',
    ]);
  });

  it('strips visitor and client-address headers from Storage calls only (integration review L2)', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const base = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (input instanceof Request) {
        seen.push({ url: input.url, headers: new Headers(init?.headers ?? input.headers) });
      } else {
        seen.push({
          url: input instanceof URL ? input.href : input,
          headers: new Headers(init?.headers),
        });
      }
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const visitor = {
      'X-Visitor-Key': 'k',
      'X-Jadarat-Client': 'k',
      'X-Real-IP': '203.0.113.7',
      'X-Forwarded-For': '203.0.113.7',
      Forwarded: 'for=203.0.113.7',
      apikey: 'self-hosted',
    };
    for (const origin of ['https://gateway:8445', null]) {
      seen.length = 0;
      const routed = storageRoutingFetch(origin, base, ['X-Visitor-Key']);
      await routed('https://gateway:8443/storage/v1/object/sign/imports/a', {
        method: 'POST',
        headers: visitor,
      });
      await routed(
        new Request('https://gateway:8443/storage/v1/object/sign/imports/b', {
          method: 'POST',
          headers: visitor,
        }),
      );
      await routed('https://gateway:8443/auth/v1/user', { headers: visitor });
      const [byInit, byRequest, auth] = seen;
      for (const call of [byInit, byRequest]) {
        expect([...(call?.headers.keys() ?? [])]).toEqual(['apikey']);
      }
      expect(auth?.headers.get('x-visitor-key')).toBe('k');
      expect(auth?.headers.get('x-jadarat-client')).toBe('k');
    }
    expect(STORAGE_STRIPPED_HEADERS).toContain('x-jadarat-client');
  });
});

type Answer = { data: unknown; error: unknown } | Error;

function fakeClient(answer: Answer) {
  const calls: { bucket: string; method: string; args: unknown[] }[] = [];
  const respond = () =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  const client = {
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (...args: unknown[]) => {
          calls.push({ bucket, method: 'upload', args });
          return respond();
        },
        createSignedUrl: (...args: unknown[]) => {
          calls.push({ bucket, method: 'download', args });
          return respond();
        },
        download: (...args: unknown[]) => ({
          asStream: () => {
            calls.push({ bucket, method: 'read', args });
            return respond();
          },
        }),
      }),
    },
  };
  return { calls, client: client as unknown as SupabaseClient };
}

describe('createUserFileStorage', () => {
  it('refuses to sign inside a database transaction of the request; signs after it (integration review M1)', async () => {
    const fake = fakeClient({
      data: {
        signedUrl: 'https://x.supabase.co/storage/v1/object/sign/imports/k?token=t',
        token: 't',
      },
      error: null,
    });
    const storage = createUserFileStorage(fake.client, null);
    const db = {
      transaction: (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ execute: () => Promise.resolve([]) }),
    } as unknown as AppDatabase;
    await expect(
      runWithClaims(db, '{}', () => storage.createSignedUploadUrl('imports', 'k')),
    ).rejects.toThrow(/Signing a Storage upload URL must run after the transaction commits/);
    await expect(
      runWithClaims(db, '{}', () => storage.createSignedDownloadUrl('imports', 'k', 60, 'a.csv')),
    ).rejects.toThrow(/Signing a Storage download URL must run after the transaction commits/);
    expect(fake.calls).toEqual([]);
    await runWithClaims(db, '{}', () => Promise.resolve());
    await expect(storage.createSignedDownloadUrl('imports', 'k', 60, 'a.csv')).resolves.toContain(
      'token=t',
    );
  });

  it('asks for a signed upload URL for exactly the key, without upsert, at the public origin', async () => {
    const fake = fakeClient({
      data: {
        signedUrl: 'https://gateway:8443/storage/v1/object/upload/sign/imports/k?token=t',
        token: 't',
        path: 'k',
      },
      error: null,
    });
    const storage = createUserFileStorage(fake.client, 'https://tms.customer.example');
    expect(await storage.createSignedUploadUrl('imports', 'k')).toEqual({
      url: 'https://tms.customer.example/storage/v1/object/upload/sign/imports/k?token=t',
      token: 't',
    });
    expect(fake.calls).toEqual([{ bucket: 'imports', method: 'upload', args: ['k'] }]);
  });

  it('adds the download name once (RFC 5987 by Storage) to the signed download URL', async () => {
    const fake = fakeClient({
      data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/imports/k?token=t' },
      error: null,
    });
    const url = await createUserFileStorage(fake.client, null).createSignedDownloadUrl(
      'imports',
      'k',
      60,
      'موظفو الرياض.csv',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('download')).toBe('موظفو الرياض.csv');
    expect(parsed.searchParams.get('token')).toBe('t');
    expect(url).not.toContain('%25');
    expect(fake.calls[0]?.args).toEqual(['k', 60]);
  });

  it('turns refusals and outages into FileStorageError', async () => {
    const refused = createUserFileStorage(
      fakeClient({ data: null, error: { status: 400, statusCode: '403' } }).client,
      null,
    );
    await expect(refused.createSignedUploadUrl('imports', 'k')).rejects.toMatchObject({
      code: 'STORAGE_FORBIDDEN',
    });
    await expect(refused.createSignedDownloadUrl('imports', 'k', 60, 'a')).rejects.toMatchObject({
      code: 'STORAGE_FORBIDDEN',
    });
    const down = createUserFileStorage(fakeClient(new Error('fetch failed')).client, null);
    await expect(down.createSignedUploadUrl('imports', 'k')).rejects.toBeInstanceOf(
      FileStorageError,
    );
    await expect(down.createSignedDownloadUrl('imports', 'k', 60, 'a')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      temporary: true,
    });
  });

  it('reads an object the policies let the user read, stopping past the limit (WP-ADM-02)', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const streamOf = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 4));
          controller.enqueue(bytes.subarray(4));
          controller.close();
        },
      });
    const fake = fakeClient({ data: streamOf(), error: null });
    expect(await createUserFileStorage(fake.client, null).readObject('images', 'k', 8)).toEqual(
      bytes,
    );
    expect(fake.calls).toEqual([{ bucket: 'images', method: 'read', args: ['k'] }]);
    const capped = fakeClient({ data: streamOf(), error: null });
    expect(await createUserFileStorage(capped.client, null).readObject('images', 'k', 7)).toBe(
      'too_large',
    );
    // Refused by the policies or missing: nothing (Storage answers both the same).
    const hidden = fakeClient({ data: null, error: { status: 400, statusCode: '404' } });
    expect(
      await createUserFileStorage(hidden.client, null).readObject('images', 'k', 8),
    ).toBeNull();
    const forbidden = fakeClient({ data: null, error: { status: 400, statusCode: '403' } });
    expect(
      await createUserFileStorage(forbidden.client, null).readObject('images', 'k', 8),
    ).toBeNull();
    // Unavailable: worth another try.
    const down = createUserFileStorage(fakeClient(new Error('fetch failed')).client, null);
    await expect(down.readObject('images', 'k', 8)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      temporary: true,
    });
    const failing = createUserFileStorage(
      fakeClient({ data: null, error: { status: 503 } }).client,
      null,
    );
    await expect(failing.readObject('images', 'k', 8)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('never reads inside a database transaction of the request', async () => {
    const fake = fakeClient({ data: null, error: null });
    const storage = createUserFileStorage(fake.client, null);
    const db = {
      transaction: (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ execute: () => Promise.resolve([]) }),
    } as unknown as AppDatabase;
    await expect(
      runWithClaims(db, '{}', () => storage.readObject('images', 'k', 8)),
    ).rejects.toThrow(/Reading a Storage object must run after the transaction commits/);
    expect(fake.calls).toEqual([]);
  });
});
