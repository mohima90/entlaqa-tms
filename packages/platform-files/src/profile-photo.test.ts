import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_PHOTO_MAX_BYTES,
  checkProfilePhotoUpload,
  prepareProfilePhoto,
  profilePhotoObject,
  readProfilePhotoUpload,
} from './profile-photo';
import { pngChunk, pngImage } from './test-fixtures';

const db = vi.hoisted(() => {
  class DomainError extends Error {
    constructor(
      readonly code: string,
      options?: { cause?: unknown },
    ) {
      super(code, options);
    }
  }
  return { DomainError, assertNoDatabaseTransaction: vi.fn() };
});
vi.mock('@jadarat/platform-db', () => db);

const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PERSON = '3c4d5e6f-7081-4b9c-8d0e-2f3a4b5c6d7e';
const FILE = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d';
const KEY = `${TENANT}/platform/person/${PERSON}/${FILE}`;
/** A photo with EXIF (a GPS marker) and a text chunk; the copy must come without both. */
const CLEAN = pngImage(120, 120);
const PNG = pngImage(120, 120, [
  pngChunk('eXIf', new TextEncoder().encode('MM\u0000*GPSLatitude 24.7 N')),
  pngChunk('tEXt', new TextEncoder().encode('Author\u0000someone')),
]);

function storage(answer: Uint8Array | 'too_large' | null | Error) {
  return {
    createSignedUploadUrl: vi.fn(),
    createSignedDownloadUrl: vi.fn(),
    readObject: vi.fn(() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    ),
  };
}

beforeEach(() => {
  db.assertNoDatabaseTransaction.mockReset();
});

describe('profile photos (WP-ADM-04; not virus-scanned, PO 21 Oct 2026)', () => {
  it('the limit is 2 MB', () => {
    expect(PROFILE_PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it('checks the name and the size before anything is reserved', () => {
    expect(checkProfilePhotoUpload('me.jpg', 90_000)).toBeNull();
    expect(checkProfilePhotoUpload('me.JPEG', 1)).toBeNull();
    expect(checkProfilePhotoUpload('me.webp', PROFILE_PHOTO_MAX_BYTES)).toBeNull();
    expect(checkProfilePhotoUpload('me.svg', 100)).toBe('TYPE_NOT_ALLOWED');
    expect(checkProfilePhotoUpload('me.gif', 100)).toBe('TYPE_NOT_ALLOWED');
    expect(checkProfilePhotoUpload('me', 100)).toBe('TYPE_NOT_ALLOWED');
    expect(checkProfilePhotoUpload('me.png', 0)).toBe('EMPTY');
    expect(checkProfilePhotoUpload('me.png', PROFILE_PHOTO_MAX_BYTES + 1)).toBe('TOO_LARGE');
  });

  it('the key of a person’s upload; never anything but UUIDs', () => {
    expect(profilePhotoObject(TENANT, PERSON, FILE)).toEqual({ bucket: 'images', objectKey: KEY });
    expect(profilePhotoObject(TENANT, PERSON, '../../etc/passwd')).toBeNull();
    expect(profilePhotoObject(`${TENANT}/x`, PERSON, FILE)).toBeNull();
    expect(profilePhotoObject(TENANT, 'x', FILE)).toBeNull();
  });

  it('reads the member’s own upload with their session (capped at 2 MB) and prepares the copy', async () => {
    const s = storage(PNG);
    const read = await readProfilePhotoUpload(s, {
      tenantId: TENANT,
      personId: PERSON,
      fileId: FILE,
    });
    expect(db.assertNoDatabaseTransaction).toHaveBeenCalledWith('readProfilePhotoUpload');
    expect(s.readObject).toHaveBeenCalledWith('images', KEY, PROFILE_PHOTO_MAX_BYTES);
    expect(read).toEqual({
      prepared: {
        fileId: FILE,
        sourceSha256: createHash('sha256').update(PNG).digest('hex'),
        sourceSize: PNG.length,
        contentType: 'image/png',
        content: CLEAN,
      },
    });
  });

  it('removes the hidden details from the copy (EXIF position, text) and anything after the image', async () => {
    const tail = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const prepared = await prepareProfilePhoto(new Uint8Array([...PNG, ...tail]));
    expect('prepared' in prepared).toBe(true);
    const copy = 'prepared' in prepared ? Buffer.from(prepared.prepared.content) : Buffer.alloc(0);
    expect(copy.equals(Buffer.from(CLEAN))).toBe(true);
    expect(copy.includes('GPSLatitude')).toBe(false);
    expect(copy.includes('someone')).toBe(false);
    expect(copy.includes('<script>')).toBe(false);
  });

  it('nothing to read (the photo already shown, someone else’s, another organization’s): missing', async () => {
    expect(
      await readProfilePhotoUpload(storage(null), {
        tenantId: TENANT,
        personId: PERSON,
        fileId: FILE,
      }),
    ).toEqual({ missing: true });
    const s = storage(PNG);
    expect(
      await readProfilePhotoUpload(s, { tenantId: TENANT, personId: PERSON, fileId: 'not-a-uuid' }),
    ).toEqual({ missing: true });
    expect(s.readObject).not.toHaveBeenCalled();
  });

  it('refuses by content with the reason: too large, SVG, HTML, GIF, too many pixels, empty, damaged', async () => {
    expect(
      await readProfilePhotoUpload(storage('too_large'), {
        tenantId: TENANT,
        personId: PERSON,
        fileId: FILE,
      }),
    ).toEqual({ refused: 'TOO_LARGE' });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(await prepareProfilePhoto(svg)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    const html = new TextEncoder().encode('<!doctype html><html><script>alert(1)</script></html>');
    expect(await prepareProfilePhoto(html)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    const gif = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;');
    expect(await prepareProfilePhoto(gif)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    // A name like me.png does not matter: the bytes decide.
    expect(await prepareProfilePhoto(new TextEncoder().encode('MZ executable'))).toEqual({
      refused: 'TYPE_NOT_ALLOWED',
    });
    expect(await prepareProfilePhoto(pngImage(5000, 10))).toEqual({
      refused: 'DIMENSIONS_TOO_LARGE',
    });
    expect(await prepareProfilePhoto(new Uint8Array())).toEqual({ refused: 'EMPTY' });
    expect(await prepareProfilePhoto(new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1))).toEqual({
      refused: 'TOO_LARGE',
    });
    const refused = await prepareProfilePhoto(PNG.slice(0, 20));
    expect(
      'refused' in refused && ['MALFORMED', 'TYPE_NOT_ALLOWED'].includes(refused.refused),
    ).toBe(true);
  });

  it('Storage unavailable: the caller hears it (a temporary failure); a bug stays a bug', async () => {
    const down = Object.assign(new Error('down'), { temporary: true });
    await expect(
      readProfilePhotoUpload(storage(down), { tenantId: TENANT, personId: PERSON, fileId: FILE }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    const bug = new Error('bug');
    await expect(
      readProfilePhotoUpload(storage(bug), { tenantId: TENANT, personId: PERSON, fileId: FILE }),
    ).rejects.toBe(bug);
  });
});
