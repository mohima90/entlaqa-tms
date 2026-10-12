import { describe, expect, it } from 'vitest';
import { StorageAdminError, createStorageAdmin } from './storage';

const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ENTITY = '0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a';
const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const KEY = `${TENANT}/platform/user_import/${ENTITY}/${FILE}`;
const SETTINGS = { url: 'https://gateway:8444/', secretKey: 'worker-key-placeholder' };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    if (!next) throw new Error('no response');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { calls, impl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createStorageAdmin', () => {
  it('reads an object as a stream with its length, with the key on both headers', async () => {
    const fake = fakeFetch(
      new Response('a,b\n', { status: 200, headers: { 'content-length': '4' } }),
    );
    const object = await createStorageAdmin(SETTINGS, fake.impl).read('imports', KEY);
    expect(object?.size).toBe(4);
    expect(await new Response(object?.body).text()).toBe('a,b\n');
    expect(fake.calls[0]?.url).toBe(
      `https://gateway:8444/storage/v1/object/authenticated/imports/${KEY}`,
    );
    expect(fake.calls[0]?.init.redirect).toBe('error');
    expect(fake.calls[0]?.init.headers).toMatchObject({
      apikey: SETTINGS.secretKey,
      authorization: `Bearer ${SETTINGS.secretKey}`,
    });
  });

  it('reports a missing object as null (404, or 400 with Storage’s not-found code)', async () => {
    const admin = (r: Response) => createStorageAdmin(SETTINGS, fakeFetch(r).impl);
    expect(await admin(new Response(null, { status: 404 })).read('imports', KEY)).toBeNull();
    expect(
      await admin(json(400, { statusCode: '404', error: 'not_found' })).read('imports', KEY),
    ).toBeNull();
    await expect(
      admin(json(400, { statusCode: '400', error: 'invalid' })).read('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_400', temporary: false });
    await expect(
      admin(new Response('not json', { status: 400 })).read('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_400' });
  });

  it('classifies failures without Storage’s message; unknown length is null', async () => {
    const admin = (r: Response | Error) => createStorageAdmin(SETTINGS, fakeFetch(r).impl);
    await expect(
      admin(new Response(null, { status: 403 })).read('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_ADMIN_KEY', temporary: true });
    await expect(
      admin(new Response(null, { status: 503 })).read('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_503', temporary: true });
    await expect(admin(new TypeError('fetch failed')).read('imports', KEY)).rejects.toMatchObject({
      code: 'STORAGE_UNREACHABLE',
      temporary: true,
    });
    await expect(
      admin(new Response(null, { status: 200 })).read('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_NO_BODY' });
    const object = await admin(new Response('x', { status: 200 })).read('imports', KEY);
    expect(object?.size).toBeNull();
  });

  it('refuses keys and buckets outside the layout before any call', async () => {
    const fake = fakeFetch(new Response('x'));
    const admin = createStorageAdmin(SETTINGS, fake.impl);
    for (const [bucket, key] of [
      ['imports', '../etc/passwd'],
      ['imports', `${KEY}/extra`],
      ['Imports', KEY],
      ['imports', KEY.replace('platform', 'Platform')],
    ] as const) {
      await expect(admin.read(bucket, key)).rejects.toBeInstanceOf(StorageAdminError);
    }
    await expect(admin.move('imports', KEY, '../x')).rejects.toMatchObject({
      code: 'INVALID_OBJECT_KEY',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('moves, removes and writes', async () => {
    const fake = fakeFetch(
      json(200, { message: 'ok' }),
      json(400, { statusCode: '404', error: 'not_found' }),
      new Response(null, { status: 200 }),
      new Response(null, { status: 404 }),
      json(200, { Key: 'k' }),
    );
    const admin = createStorageAdmin(SETTINGS, fake.impl);
    expect(await admin.move('imports', KEY, 'quarantine')).toBe('moved');
    expect(JSON.parse(fake.calls[0]?.init.body as string)).toEqual({
      bucketId: 'imports',
      sourceKey: KEY,
      destinationBucket: 'quarantine',
      destinationKey: KEY,
    });
    expect(await admin.move('imports', KEY, 'quarantine')).toBe('missing');
    await admin.remove('imports', KEY);
    expect(fake.calls[2]?.init.method).toBe('DELETE');
    await admin.remove('imports', KEY);
    await admin.write('generated', KEY, new Uint8Array([1, 2, 3]), 'text/csv');
    expect(fake.calls[4]?.init.headers).toMatchObject({
      'content-type': 'text/csv',
      'x-upsert': 'false',
    });
  });

  it('surfaces failures of move, remove and write', async () => {
    const admin = (r: Response) => createStorageAdmin(SETTINGS, fakeFetch(r).impl);
    await expect(
      admin(new Response(null, { status: 500 })).move('imports', KEY, 'quarantine'),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_500' });
    await expect(
      admin(new Response(null, { status: 429 })).remove('imports', KEY),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_429', temporary: true });
    await expect(
      admin(json(409, { error: 'Duplicate' })).write(
        'generated',
        KEY,
        new Uint8Array(1),
        'text/csv',
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_409', temporary: false });
  });
});
