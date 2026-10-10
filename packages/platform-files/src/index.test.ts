import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINAL_STATUSES,
  XLSX,
  confirmUpload,
  createDownloadGrant,
  createUploadIntent,
  deleteFile,
  getFileStatus,
  markFileUsed,
} from './index';

const db = vi.hoisted(() => {
  class DomainError extends Error {
    constructor(
      readonly code: string,
      options?: { cause?: unknown },
    ) {
      super(code, options);
    }
  }
  return {
    DomainError,
    reserveUpload: vi.fn(),
    confirmFileUpload: vi.fn(),
    getFileStatus: vi.fn(),
    grantFileDownload: vi.fn(),
    insertAuditEvent: vi.fn(),
    deleteFileRecord: vi.fn(),
    markFileUsed: vi.fn(),
  };
});
vi.mock('@jadarat/platform-db', () => db);

const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const ENTITY = '0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a';
const TX = { tx: true } as never;
const ACTOR = { userId: 'u', tenantId: 't' } as never;

function context() {
  const ownTx = vi.fn(<T>(fn: (tx: never) => Promise<T>) => fn(TX));
  const storage = {
    createSignedUploadUrl: vi.fn(() =>
      Promise.resolve({
        url: 'https://tms.example/storage/v1/object/upload/sign/k?token=t',
        token: 't',
      }),
    ),
    createSignedDownloadUrl: vi.fn(() =>
      Promise.resolve('https://tms.example/storage/v1/object/sign/k?token=t&download=a.csv'),
    ),
  };
  return { ownTx, storage, context: { ownTx: ownTx as never, storage } };
}

const intent = {
  purpose: 'platform.user_import' as const,
  owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
  declaredName: 'موظفو/الرياض.CSV',
  size: 120,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.reserveUpload.mockResolvedValue({
    fileId: FILE,
    bucket: 'imports',
    objectKey: 'k',
    uploadExpiresAt: new Date('2026-10-09T08:15:00Z'),
    maxBytes: 20971520,
  });
});

describe('createUploadIntent', () => {
  it('reserves in its own transaction, then asks Storage for exactly that key', async () => {
    const { ownTx, storage, context: ctx } = context();
    const result = await createUploadIntent(ctx, intent);
    expect(result).toEqual({
      fileId: FILE,
      url: 'https://tms.example/storage/v1/object/upload/sign/k?token=t',
      method: 'PUT',
      contentType: 'text/csv',
      maxBytes: 20971520,
      expiresAt: new Date('2026-10-09T08:15:00Z'),
    });
    expect(ownTx).toHaveBeenCalledTimes(1);
    expect(db.reserveUpload).toHaveBeenCalledWith(TX, {
      purpose: 'platform.user_import',
      owner: intent.owner,
      name: 'موظفو_الرياض.CSV',
      declaredType: 'text/csv',
      size: 120,
    });
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith('imports', 'k');
    // The reservation is committed BEFORE Storage is asked (Storage reads committed rows only).
    expect(ownTx.mock.invocationCallOrder[0]).toBeLessThan(
      storage.createSignedUploadUrl.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('refuses early what the purpose does not allow', async () => {
    const { context: ctx, ownTx } = context();
    const refused = async (overrides: Record<string, unknown>) =>
      createUploadIntent(ctx, { ...intent, ...overrides }).then(
        () => 'accepted',
        (error: unknown) => (error as { code: string }).code,
      );
    expect(await refused({ purpose: 'platform.user_import_report' })).toBe('UNKNOWN_PURPOSE');
    expect(await refused({ purpose: 'constructor' })).toBe('UNKNOWN_PURPOSE');
    expect(await refused({ owner: { ...intent.owner, module: 'Platform' } })).toBe(
      'INVALID_FILE_DATA',
    );
    expect(await refused({ owner: { ...intent.owner, entityId: 'x' } })).toBe('INVALID_FILE_DATA');
    expect(await refused({ owner: { ...intent.owner, entityType: '1x' } })).toBe(
      'INVALID_FILE_DATA',
    );
    expect(await refused({ size: 0 })).toBe('TOO_LARGE');
    expect(await refused({ size: 20 * 1024 * 1024 + 1 })).toBe('TOO_LARGE');
    expect(await refused({ size: 1.5 })).toBe('TOO_LARGE');
    // The name's extension must name a type the purpose accepts — whatever the browser claims.
    for (const declaredName of [
      'run.exe',
      'staff.csv.hta',
      'update.js',
      'tool.bat',
      'export',
      'cv.pdf',
    ]) {
      expect(await refused({ declaredName, declaredType: 'text/csv' }), declaredName).toBe(
        'TYPE_NOT_ALLOWED',
      );
    }
    expect(await refused({ declaredName: 'staff.xlsx' })).toBe('accepted');
    expect(ownTx).toHaveBeenCalledTimes(1);
    expect(db.reserveUpload.mock.calls[0]?.[1]).toMatchObject({ declaredType: XLSX });
  });

  it('reports a Storage refusal or outage without its message', async () => {
    const { storage, context: ctx } = context();
    storage.createSignedUploadUrl.mockRejectedValueOnce({
      code: 'STORAGE_FORBIDDEN',
      temporary: false,
    });
    await expect(createUploadIntent(ctx, intent)).rejects.toMatchObject({
      code: 'STORAGE_REFUSED',
    });
    storage.createSignedUploadUrl.mockRejectedValueOnce({
      code: 'STORAGE_UNAVAILABLE',
      temporary: true,
    });
    await expect(createUploadIntent(ctx, intent)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
  });
});

describe('confirmUpload, getFileStatus, deleteFile, markFileUsed', () => {
  it('confirms and returns the status view', async () => {
    db.confirmFileUpload.mockResolvedValue('uploaded');
    db.getFileStatus.mockResolvedValue({ fileId: FILE, status: 'uploaded' });
    expect(await confirmUpload(TX, FILE)).toEqual({ fileId: FILE, status: 'uploaded' });
    db.getFileStatus.mockResolvedValue(null);
    await expect(confirmUpload(TX, FILE)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(await getFileStatus(TX, FILE)).toBeNull();
  });

  it('passes deletion and use through', async () => {
    db.deleteFileRecord.mockResolvedValue(true);
    db.markFileUsed.mockResolvedValue(false);
    expect(await deleteFile(TX, FILE)).toBe(true);
    expect(await markFileUsed(TX, FILE)).toBe(false);
    expect(FINAL_STATUSES).toContain('clean');
    expect(FINAL_STATUSES).not.toContain('scanning');
  });
});

describe('createDownloadGrant', () => {
  const grant = {
    bucket: 'imports',
    objectKey: 'k',
    name: 'a.csv',
    detectedType: 'text/csv',
    ttlSeconds: 60,
    auditDownloads: true,
  };
  const request = {
    fileId: FILE,
    purpose: 'platform.user_import' as const,
    owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
  };

  it('grants and audits in its own transaction for the authorized owner, then asks Storage for a URL of the same lifetime', async () => {
    db.grantFileDownload.mockResolvedValue(grant);
    const { ownTx, storage, context: ctx } = context();
    const before = Date.now();
    const link = await createDownloadGrant(ctx, ACTOR, request);
    expect(link.url).toContain('download=a.csv');
    expect(link.name).toBe('a.csv');
    expect(link.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(db.grantFileDownload).toHaveBeenCalledWith(TX, request);
    expect(db.insertAuditEvent).toHaveBeenCalledWith(TX, ACTOR, {
      action: 'platform.file.download_granted',
      entityType: 'file',
      entityId: FILE,
      data: { purpose: 'platform.user_import', ttlSeconds: 60 },
    });
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith('imports', 'k', 60, 'a.csv');
    expect(ownTx.mock.invocationCallOrder[0]).toBeLessThan(
      storage.createSignedDownloadUrl.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("names the download by the type found by content, never by the uploader's extension", async () => {
    db.grantFileDownload.mockResolvedValue({ ...grant, name: 'payroll.hta' });
    const { storage, context: ctx } = context();
    const link = await createDownloadGrant(ctx, ACTOR, request);
    expect(link.name).toBe('payroll.csv');
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith('imports', 'k', 60, 'payroll.csv');
  });

  it('does not audit media downloads; refuses bad requests and Storage refusals', async () => {
    db.grantFileDownload.mockResolvedValue({ ...grant, auditDownloads: false, ttlSeconds: 300 });
    const { storage, context: ctx } = context();
    await createDownloadGrant(ctx, ACTOR, request);
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
    for (const bad of [
      { ...request, fileId: 'not-a-uuid' },
      { ...request, purpose: 'toString' as never },
      { ...request, owner: { ...request.owner, entityId: 'x' } },
      { ...request, owner: { ...request.owner, module: 'Platform' } },
      { ...request, owner: { ...request.owner, entityType: '../x' } },
    ]) {
      await expect(createDownloadGrant(ctx, ACTOR, bad)).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
      });
    }
    expect(db.grantFileDownload).toHaveBeenCalledTimes(1);
    storage.createSignedDownloadUrl.mockRejectedValueOnce(new Error('x'));
    await expect(createDownloadGrant(ctx, ACTOR, request)).rejects.toMatchObject({
      code: 'STORAGE_REFUSED',
    });
  });
});
