import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG, streamOf } from '../test-fixtures';
import { BRAND_ASSET_BATCH, BRAND_ASSET_TASK, createBrandAssetTask } from './brand-assets';

const db = vi.hoisted(() => ({
  claimBrandAssetWork: vi.fn(),
  publishBrandAsset: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

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
});

describe('branding image publishing task (WP-ADM-02)', () => {
  it('reads each due image in its tenant and publishes the checked bytes', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'logo' }]);
    db.publishBrandAsset.mockResolvedValue('3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d');
    const { task, files, log } = setup(() => Promise.resolve(streamOf(PNG.subarray(0, 8), PNG.subarray(8))));
    expect(task.name).toBe(BRAND_ASSET_TASK);
    await expect(task.run({ jobId: 'job-1' })).resolves.toBe(false);
    expect(db.claimBrandAssetWork).toHaveBeenCalledWith({}, BRAND_ASSET_BATCH);
    expect(actors).toEqual([{ jobId: 'job-1' }, { tenantId: TENANT, jobId: 'job-1' }]);
    expect(files.openScannedFile).toHaveBeenCalledWith({}, FILE);
    const [, work, bytes] = db.publishBrandAsset.mock.calls[0] ?? [];
    expect(work).toEqual({ tenantId: TENANT, fileId: FILE, kind: 'logo' });
    expect(Buffer.from(bytes as Uint8Array)).toEqual(Buffer.from(PNG));
    expect(log).toHaveBeenCalledWith('info', 'branding images published: 1');
  });

  it('never publishes content that is not PNG, JPEG or WebP (an SVG)', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'favicon' }]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const { task, log } = setup(() => Promise.resolve(streamOf(svg)));
    await task.run({ jobId: 'job-2' });
    expect(db.publishBrandAsset).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', `branding image ${FILE} not published: TYPE_NOT_ALLOWED`);
  });

  it('stops reading past the purpose limit', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'favicon' }]);
    const big = new Uint8Array(500 * 1024 + 1);
    const { task, log } = setup(() => Promise.resolve(streamOf(big)));
    await task.run({ jobId: 'job-3' });
    expect(db.publishBrandAsset).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('error', `branding image ${FILE} not published: TOO_LARGE`);
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
    expect(log).toHaveBeenCalledWith('warning', 'branding images: storage unavailable (DOWN); later');

    const broken = Object.assign(new Error('secret detail'), { code: 'FILE_NOT_CLEAN' });
    const second = setup(() => Promise.reject(broken));
    await second.task.run({ jobId: 'job-5' });
    expect(second.log).toHaveBeenCalledWith('error', `branding image ${FILE} not published: FILE_NOT_CLEAN`);
    expect(JSON.stringify(second.log.mock.calls)).not.toContain('secret detail');
  });

  it('an image no longer in use is skipped quietly', async () => {
    db.claimBrandAssetWork.mockResolvedValue([{ tenantId: TENANT, fileId: FILE, kind: 'logo' }]);
    db.publishBrandAsset.mockResolvedValue(null);
    const { task, log } = setup(() => Promise.resolve(streamOf(PNG)));
    await task.run({ jobId: 'job-6' });
    expect(log).not.toHaveBeenCalled();
  });
});
