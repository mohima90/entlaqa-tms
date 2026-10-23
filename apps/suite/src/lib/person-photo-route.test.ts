import { appError, err, ok } from '@jadarat/platform-core';
import { describe, expect, it, vi } from 'vitest';
import {
  PERSON_PHOTO_MAX_AGE_SECONDS,
  type PersonPhotoDeps,
  personPhotoResponse,
} from './person-photo-route';

vi.mock('server-only', () => ({}));
vi.mock('./users-queries', () => ({ personPhotoQuery: vi.fn() }));

const PERSON = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';
const SHA = 'a'.repeat(64);
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function deps(answer: Awaited<ReturnType<PersonPhotoDeps['load']>>) {
  const load = vi.fn(() => Promise.resolve(answer));
  return { load: load as unknown as PersonPhotoDeps['load'], calls: load };
}

const get = (headers: Record<string, string> = {}) =>
  new Request(`https://raya.example.test/api/photo/${PERSON}`, { headers });

describe('/api/photo/<person> (WP-ADM-04)', () => {
  it('serves the photo inline, typed, private to the browser, never sniffed or run, same-origin only', async () => {
    const d = deps(
      ok({ notModified: false, contentType: 'image/png', sha256: SHA, content: BYTES }),
    );
    const response = await personPhotoResponse(get(), PERSON, d);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe(
      `private, max-age=${String(PERSON_PHOTO_MAX_AGE_SECONDS)}`,
    );
    expect(response.headers.get('cache-control')).not.toContain('public');
    expect(response.headers.get('etag')).toBe(`"${SHA}"`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(d.calls).toHaveBeenCalledWith({ personId: PERSON, ifNoneMatch: null });
  });

  it('answers 304 without a body when the browser already holds this copy', async () => {
    const d = deps(ok({ notModified: true, contentType: 'image/png', sha256: SHA }));
    const response = await personPhotoResponse(get({ 'if-none-match': `"${SHA}"` }), PERSON, d);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(`"${SHA}"`);
    expect(await response.text()).toBe('');
    expect(d.calls).toHaveBeenCalledWith({ personId: PERSON, ifNoneMatch: `"${SHA}"` });
  });

  it('401 without a session, 403 when refused, 404 for everything else — nothing to learn from the answer', async () => {
    for (const [error, status] of [
      [appError('UNAUTHENTICATED'), 401],
      [appError('FORBIDDEN'), 403],
      [appError('NOT_FOUND'), 404],
      [appError('VALIDATION_FAILED'), 404],
      [appError('NOT_CONFIGURED'), 404],
    ] as const) {
      const response = await personPhotoResponse(get(), PERSON, deps(err(error)));
      expect(response.status, error.code).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    }
  });

  it('404 for a malformed id without asking the database, and for a type that is not a photo', async () => {
    const d = deps(
      ok({ notModified: false, contentType: 'image/png', sha256: SHA, content: BYTES }),
    );
    expect((await personPhotoResponse(get(), '../etc/passwd', d)).status).toBe(404);
    expect((await personPhotoResponse(get(), PERSON.toUpperCase(), d)).status).toBe(404);
    expect(d.calls).not.toHaveBeenCalled();
    const svg = deps(
      ok({ notModified: false, contentType: 'image/svg+xml', sha256: SHA, content: BYTES }),
    );
    expect((await personPhotoResponse(get(), PERSON, svg)).status).toBe(404);
  });
});
