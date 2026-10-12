import { createHash } from 'node:crypto';
import { DomainError } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, streamOf } from '../test-fixtures';
import { FileIntegrityError, createWorkerFiles } from './worker-files';

const db = vi.hoisted(() => ({
  loadCleanFile: vi.fn(),
  createGeneratedFile: vi.fn(),
  finishGeneratedFile: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const csv = new TextEncoder().encode('email,name\nsara@example.com,سارة\n');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const tx = {} as never;

function fakeStore(object: Uint8Array[] | null) {
  return {
    read: vi.fn(() => Promise.resolve(object ? { body: streamOf(...object), size: null } : null)),
    move: vi.fn(),
    remove: vi.fn(),
    write: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('openScannedFile', () => {
  it('streams a clean file, checking the size and hash recorded by the scan', async () => {
    db.loadCleanFile.mockResolvedValue({
      bucket: 'imports',
      objectKey: 'k',
      size: csv.length,
      sha256: sha(csv),
    });
    const store = fakeStore([csv.subarray(0, 7), csv.subarray(7)]);
    const stream = await createWorkerFiles({ store }).openScannedFile(tx, FILE);
    expect(await collect(stream)).toEqual(csv);
    expect(store.read).toHaveBeenCalledWith('imports', 'k');
  });

  it('fails at the end when the stored bytes differ from the scanned ones', async () => {
    db.loadCleanFile.mockResolvedValue({
      bucket: 'imports',
      objectKey: 'k',
      size: csv.length,
      sha256: sha(csv),
    });
    const tampered = csv.slice();
    tampered[0] = 0x45;
    const stream = await createWorkerFiles({ store: fakeStore([tampered]) }).openScannedFile(
      tx,
      FILE,
    );
    await expect(collect(stream)).rejects.toBeInstanceOf(FileIntegrityError);
  });

  it('refuses a file that is not clean, or whose object is gone', async () => {
    db.loadCleanFile.mockResolvedValue(null);
    await expect(
      createWorkerFiles({ store: fakeStore([csv]) }).openScannedFile(tx, FILE),
    ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    db.loadCleanFile.mockResolvedValue({ bucket: 'imports', objectKey: 'k', size: 1, sha256: 'x' });
    await expect(
      createWorkerFiles({ store: fakeStore(null) }).openScannedFile(tx, FILE),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('storeGeneratedFile', () => {
  const report = {
    purpose: 'platform.user_import_report' as const,
    owner: { module: 'platform', entityType: 'user_import', entityId: FILE },
    name: 'errors/report.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: new Uint8Array(csv),
    forUserId: null,
  };

  it('reserves the key, writes the bytes and records them as clean', async () => {
    db.createGeneratedFile.mockResolvedValue({
      fileId: FILE,
      bucket: 'generated',
      objectKey: 'g',
    });
    db.finishGeneratedFile.mockResolvedValue(true);
    const store = fakeStore(null);
    expect(await createWorkerFiles({ store }).storeGeneratedFile(tx, report)).toBe(FILE);
    expect(db.createGeneratedFile).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ name: 'errors_report.xlsx', size: csv.length }),
    );
    expect(store.write).toHaveBeenCalledWith('generated', 'g', report.bytes, report.type);
    expect(db.finishGeneratedFile).toHaveBeenCalledWith(tx, FILE, csv.length, sha(csv));
  });

  it('refuses a type the purpose does not allow, and a write that left no object', async () => {
    await expect(
      createWorkerFiles({ store: fakeStore(null) }).storeGeneratedFile(tx, {
        ...report,
        type: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'TYPE_NOT_ALLOWED' });
    // The import's reports are XLSX only (security review L2).
    await expect(
      createWorkerFiles({ store: fakeStore(null) }).storeGeneratedFile(tx, {
        ...report,
        type: 'text/csv',
      }),
    ).rejects.toMatchObject({ code: 'TYPE_NOT_ALLOWED' });
    await expect(
      createWorkerFiles({ store: fakeStore(null) }).storeGeneratedFile(tx, {
        ...report,
        purpose: 'platform.user_import' as never,
      }),
    ).rejects.toMatchObject({ code: 'TYPE_NOT_ALLOWED' });
    db.createGeneratedFile.mockResolvedValue({ fileId: FILE, bucket: 'generated', objectKey: 'g' });
    db.finishGeneratedFile.mockResolvedValue(false);
    await expect(
      createWorkerFiles({ store: fakeStore(null) }).storeGeneratedFile(tx, report),
    ).rejects.toThrow('was not found');
  });
});
