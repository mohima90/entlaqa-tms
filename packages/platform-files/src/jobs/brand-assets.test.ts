import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pngChunk, pngImage, streamOf } from '../test-fixtures';
import { BRAND_ASSET_BATCH, BRAND_ASSET_TASK, createBrandAssetTask } from './brand-assets';

const db = vi.hoisted(() => ({
  claimBrandAssetWork: vi.fn(),
  noteBrandAssetFailure: vi.fn(),
  publishBrandAsset: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

/** A logo with EXIF (a GPS marker) and a text chunk; the public copy must come without both. */
const CLEAN = pngImage(120, 40);
const PNG = pngImage(120, 40, [
  pngChunk('eXIf', new TextEncoder().encode('MM\u0000*GPSLatitude 24.7 N')),
  pngChunk('tEXt', new TextEncoder().encode('Author\u0000someone')),
]);
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FILE = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d';
const actors: unknown[] = [];
const tx = <T>(actor: unknown, fn: (t: unknown) => Promise<T>) => {
  actors.push(actor);
  return fn({});
};

function setup(read: () => Promise<ReadableStream<Uint8Array>>) {
  const log = vi.fn();
  const files = { openScannedFile: vi.fn(read), storeGeneratedFile: vi.fn() };
  const task = createBrandAssetTask({
    withPlatformTx: tx as never,
    withSystemTx: tx as never,
    files,
    log,
  });
  return { task, files, log };
}

beforeEach(() => {
  actors.length = 0;
  db.claimBrandAssetWork.mockReset();
  db.publishBrandAsset.mockReset();
  db.noteBrandAssetFailure.mockReset();
  db.noteBrandAssetFailure.mockResolvedValue(1);
});

describe('branding image publishing task (WP-ADM-02)', () => {
  it('reads each due image in its tenant and publishes it without metadata', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'logo' }]);
    db.publishBrandAsset.mockResolvedValue('3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d');
    const { task, files, log } = setup(() =>
      Promise.resolve(streamOf(PNG.subarray(0, 8), PNG.subarray(8))),
    );
    expect(task.name).toBe(BRAND_ASSET_TASK);
    await expect(task.run({ jobId: 'job-1' })).resolves.toBe(false);
    expect(db.claimBrandAssetWork).toHaveBeenCalledWith({}, BRAND_ASSET_BATCH);
    expect(actors).toEqual([{ jobId: 'job-1' }, { tenantId: TENANT, jobId: 'job-1' }]);
    expect(files.openScannedFile).toHaveBeenCalledWith({}, FILE);
    const [, work, sourceSha256, bytes] = db.publishBrandAsset.mock.calls[0] ?? [];
    expect(work).toEqual({ tenantId: TENANT, fileId: FILE, kind: 'logo' });
    // The hash of what was read (the scanned file), the bytes of the stripped copy.
    expect(sourceSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(Buffer.from(bytes as Uint8Array)).toEqual(Buffer.from(CLEAN));
    expect(Buffer.from(bytes as Uint8Array).includes('GPS')).toBe(false);
    expect(db.noteBrandAssetFailure).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('info', 'branding images published: 1');
  });

  it('never publishes content that is not PNG, JPEG or WebP (an SVG)', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'favicon' }]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const { task, log } = setup(() => Promise.resolve(streamOf(svg)));
    await task.run({ jobId: 'job-2' });
    expect(db.publishBrandAsset).not.toHaveBeenCalled();
    expect(db.noteBrandAssetFailure).toHaveBeenCalledWith({}, FILE, 'TYPE_NOT_ALLOWED');
    expect(log).toHaveBeenCalledWith(
      'warning',
      `branding image ${FILE} not published: TYPE_NOT_ALLOWED (attempt 1)`,
    );
  });

  it('never publishes an image larger than its cap in pixels (a 1024 px browser icon)', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'favicon' }]);
    db.noteBrandAssetFailure.mockResolvedValue(5);
    const { task, log } = setup(() => Promise.resolve(streamOf(pngImage(1024, 1024))));
    await task.run({ jobId: 'job-2b' });
    expect(db.publishBrandAsset).not.toHaveBeenCalled();
    expect(db.noteBrandAssetFailure).toHaveBeenCalledWith({}, FILE, 'DIMENSIONS_TOO_LARGE');
    expect(log).toHaveBeenCalledWith(
      'warning',
      `branding image ${FILE} not published: DIMENSIONS_TOO_LARGE (attempt 5)`,
    );
  });

  it('stops reading past the purpose limit', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'favicon' }]);
    const big = new Uint8Array(500 * 1024 + 1);
    const { task, log } = setup(() => Promise.resolve(streamOf(big)));
    await task.run({ jobId: 'job-3' });
    expect(db.publishBrandAsset).not.toHaveBeenCalled();
    expect(db.noteBrandAssetFailure).toHaveBeenCalledWith({}, FILE, 'TOO_LARGE');
    expect(log).toHaveBeenCalledWith(
      'error',
      `branding image ${FILE} not published: TOO_LARGE (attempt 1)`,
    );
  });

  it('a temporary Storage failure ends the pass; others are logged with their code only', async () => {
    db.claimBrandAssetWork.mockResolvedValue([
      { tenantId: TENANT, fileId: FILE, kind: 'logo' },
      { tenantId: TENANT, fileId: FILE, kind: 'favicon' },
    ]);
    const unavailable = Object.assign(new Error('storage down'), { temporary: true, code: 'DOWN' });
    const { task, files, log } = setup(() => Promise.reject(unavailable));
    await expect(task.run({ jobId: 'job-4' })).resolves.toBe(false);
    expect(files.openScannedFile).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'warning',
      'branding images: storage unavailable (DOWN); later',
    );
    expect(db.noteBrandAssetFailure).not.toHaveBeenCalled(); // the file is not at fault

    const broken = Object.assign(new Error('secret detail'), { code: 'FILE_NOT_CLEAN' });
    const second = setup(() => Promise.reject(broken));
    await second.task.run({ jobId: 'job-5' });
    expect(second.log).toHaveBeenCalledWith(
      'error',
      `branding image ${FILE} not published: FILE_NOT_CLEAN (attempt 1)`,
    );
    expect(db.noteBrandAssetFailure).toHaveBeenCalledWith({}, FILE, 'FILE_NOT_CLEAN');
    expect(JSON.stringify(second.log.mock.calls)).not.toContain('secret detail');
  });

  it('a failure that cannot be recorded is logged and the pass goes on', async () => {
    db.claimBrandAssetWork.mockResolvedValue([
      { tenantId: TENANT, fileId: FILE, kind: 'logo' },
      { tenantId: TENANT, fileId: FILE, kind: 'favicon' },
    ]);
    db.noteBrandAssetFailure.mockRejectedValue(Object.assign(new Error('x'), { code: '40001' }));
    const mismatch = Object.assign(new Error('differs'), { code: 'BRAND_IMAGE_MISMATCH' });
    db.publishBrandAsset.mockRejectedValue(mismatch);
    const { task, files, log } = setup(() => Promise.resolve(streamOf(PNG)));
    await task.run({ jobId: 'job-7' });
    expect(files.openScannedFile).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      'error',
      `branding image ${FILE} not published: BRAND_IMAGE_MISMATCH; not recorded (40001)`,
    );
  });

  it('an image no longer in use is skipped quietly', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'logo' }]);
    db.publishBrandAsset.mockResolvedValue(null);
    const { task, log } = setup(() => Promise.resolve(streamOf(PNG)));
    await task.run({ jobId: 'job-6' });
    expect(log).not.toHaveBeenCalled();
  });
});
