import { err, ok } from '@jadarat/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
  readBrandUpload: vi.fn(),
  fileResult: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-files', () => ({
  BRAND_IMAGE_PURPOSES: {},
  confirmUpload: vi.fn(),
  getFileStatus: vi.fn(),
  reserveUploadIntent: vi.fn(),
  signUploadIntent: vi.fn(),
  ...files,
}));
vi.mock('@jadarat/platform-files/next', () => ({ requestFileStorage: () => Promise.resolve({}) }));

const { readBrandingImage } = await import('./branding-files');

const REQUEST = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  kind: 'logo' as const,
  fileId: '66666666-6666-4666-8666-666666666666',
};

beforeEach(() => {
  vi.clearAllMocks();
  files.readBrandUpload.mockResolvedValue({ missing: true });
});

describe('readBrandingImage (the Branding save reader, WP-ADM-02)', () => {
  it('Storage unavailable is `unavailable`: the save goes through, the worker publishes (review M2)', async () => {
    files.fileResult.mockResolvedValueOnce(
      err({ code: 'FILE_STORAGE_UNAVAILABLE', status: 503, messageKey: 'x', expose: true }),
    );
    expect(await readBrandingImage(REQUEST)).toEqual(ok({ unavailable: true }));
  });

  it('any other error stays the answer', async () => {
    const refused = err({ code: 'INTERNAL_ERROR', status: 500, messageKey: 'x', expose: false });
    files.fileResult.mockResolvedValueOnce(refused);
    expect(await readBrandingImage(REQUEST)).toEqual(refused);
  });

  it('passes missing and refusals on; a prepared image becomes its publication', async () => {
    files.fileResult.mockResolvedValueOnce(ok({ missing: true }));
    expect(await readBrandingImage(REQUEST)).toEqual(ok({ missing: true }));
    files.fileResult.mockResolvedValueOnce(ok({ refused: 'TYPE_NOT_ALLOWED' }));
    expect(await readBrandingImage(REQUEST)).toEqual(ok({ refused: 'TYPE_NOT_ALLOWED' }));
    const content = new Uint8Array([1, 2, 3]);
    files.fileResult.mockResolvedValueOnce(
      ok({
        prepared: {
          fileId: REQUEST.fileId,
          slot: 'logo',
          sourceSha256: 'a'.repeat(64),
          sourceSize: 3,
          contentType: 'image/png',
          content,
        },
      }),
    );
    expect(await readBrandingImage(REQUEST)).toEqual(
      ok({
        publication: {
          fileId: REQUEST.fileId,
          kind: 'logo',
          sourceSha256: 'a'.repeat(64),
          sourceSize: 3,
          contentType: 'image/png',
          content,
        },
      }),
    );
  });
});
