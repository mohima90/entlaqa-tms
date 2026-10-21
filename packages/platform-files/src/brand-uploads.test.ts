import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandUploadObject, prepareBrandUpload, readBrandUpload } from './brand-uploads';
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
const FILE = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d';
const KEY = `${TENANT}/platform/tenant_branding/${TENANT}/${FILE}`;
/** A logo with EXIF (a GPS marker) and a text chunk; the copy must come without both. */
const CLEAN = pngImage(120, 40);
const PNG = pngImage(120, 40, [
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

describe('branding uploads without a malware scan (PO, 20 Oct 2026)', () => {
  it('the key of an upload for the organization’s Branding; never anything but UUIDs', () => {
    expect(brandUploadObject(TENANT, FILE)).toEqual({ bucket: 'images', objectKey: KEY });
    expect(brandUploadObject(TENANT, '../../etc/passwd')).toBeNull();
    expect(brandUploadObject(`${TENANT}/x`, FILE)).toBeNull();
    expect(brandUploadObject(TENANT.toUpperCase(), FILE)).toBeNull();
  });

  it('reads the upload with the user’s session (capped at the purpose limit) and prepares the copy', async () => {
    const s = storage(PNG);
    const read = await readBrandUpload(s, { tenantId: TENANT, slot: 'favicon', fileId: FILE });
    expect(db.assertNoDatabaseTransaction).toHaveBeenCalledWith('readBrandUpload');
    expect(s.readObject).toHaveBeenCalledWith('images', KEY, 500 * 1024);
    expect(read).toEqual({
      prepared: {
        fileId: FILE,
        slot: 'favicon',
        sourceSha256: createHash('sha256').update(PNG).digest('hex'),
        sourceSize: PNG.length,
        contentType: 'image/png',
        content: CLEAN,
      },
    });
  });

  it('nothing to read (the image already shown, someone else’s, another organization’s): missing', async () => {
    expect(
      await readBrandUpload(storage(null), { tenantId: TENANT, slot: 'logo', fileId: FILE }),
    ).toEqual({ missing: true });
    const s = storage(PNG);
    expect(
      await readBrandUpload(s, { tenantId: TENANT, slot: 'logo', fileId: 'not-a-uuid' }),
    ).toEqual({ missing: true });
    expect(s.readObject).not.toHaveBeenCalled();
  });

  it('refuses with the reason: too large, not an image (SVG, HTML, GIF), too many pixels, damaged', async () => {
    expect(
      await readBrandUpload(storage('too_large'), { tenantId: TENANT, slot: 'logo', fileId: FILE }),
    ).toEqual({ refused: 'TOO_LARGE' });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(await prepareBrandUpload('logo', FILE, svg)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    const html = new TextEncoder().encode('<!doctype html><html><script>alert(1)</script></html>');
    expect(await prepareBrandUpload('logo', FILE, html)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    const gif = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;');
    expect(await prepareBrandUpload('logo', FILE, gif)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    expect(await prepareBrandUpload('favicon', FILE, pngImage(1024, 1024))).toEqual({
      refused: 'DIMENSIONS_TOO_LARGE',
    });
    expect(await prepareBrandUpload('logo', FILE, new Uint8Array())).toEqual({ refused: 'EMPTY' });
    expect(await prepareBrandUpload('favicon', FILE, new Uint8Array(500 * 1024 + 1))).toEqual({
      refused: 'TOO_LARGE',
    });
    // A PNG signature with a broken header: damaged.
    const damaged = PNG.slice(0, 20);
    const refused = await prepareBrandUpload('logo', FILE, damaged);
    expect(
      'refused' in refused && ['MALFORMED', 'TYPE_NOT_ALLOWED'].includes(refused.refused),
    ).toBe(true);
  });

  it('a polyglot (HTML appended after the image) is published without what follows the image', async () => {
    const tail = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const polyglot = new Uint8Array([...CLEAN, ...tail]);
    const prepared = await prepareBrandUpload('logo', FILE, polyglot);
    expect('prepared' in prepared && Buffer.from(prepared.prepared.content)).toEqual(
      Buffer.from(CLEAN),
    );
  });

  it('Storage unavailable: the caller hears it (a temporary failure)', async () => {
    const down = Object.assign(new Error('down'), { temporary: true });
    await expect(
      readBrandUpload(storage(down), { tenantId: TENANT, slot: 'logo', fileId: FILE }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    const bug = new Error('bug');
    await expect(
      readBrandUpload(storage(bug), { tenantId: TENANT, slot: 'logo', fileId: FILE }),
    ).rejects.toBe(bug);
  });
});
