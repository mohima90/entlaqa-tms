import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINAL_STATUSES,
  FileErrors,
  XLSX,
  confirmUpload,
  fileResult,
  deleteFile,
  getFileStatus,
  grantDownload,
  markFileUsed,
  reserveUploadIntent,
  signDownload,
  signUploadIntent,
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
    isDomainError: (error: unknown) => error instanceof DomainError,
    inTransaction: false,
    assertNoDatabaseTransaction: vi.fn(),
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

function storage() {
  return {
    createSignedUploadUrl: vi.fn(() =>
      Promise.resolve({
        url: 'https://tms.example/storage/v1/object/upload/sign/k?token=t',
        token: 't',
      }),
    ),
    createSignedDownloadUrl: vi.fn(() =>
      Promise.resolve('https://tms.example/storage/v1/object/sign/k?token=t&download=a.csv'),
    ),
    readObject: vi.fn(() => Promise.resolve(null)),
  };
}

const intent = {
  purpose: 'platform.user_import' as const,
  owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
  declaredName: 'موظفو/الرياض.CSV',
  size: 120,
};

const reservation = {
  fileId: FILE,
  bucket: 'imports',
  objectKey: 'k',
  contentType: 'text/csv',
  maxBytes: 20971520,
  expiresAt: new Date('2026-10-09T08:15:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.assertNoDatabaseTransaction.mockImplementation((what: string) => {
    if (db.inTransaction) throw new Error(`${what} must run after the transaction commits`);
  });
  db.inTransaction = false;
  db.reserveUpload.mockResolvedValue({
    fileId: FILE,
    bucket: 'imports',
    objectKey: 'k',
    uploadExpiresAt: new Date('2026-10-09T08:15:00Z'),
    maxBytes: 20971520,
  });
});

describe('reserveUploadIntent (transaction step) and signUploadIntent (after the commit)', () => {
  it("reserves in the caller's transaction only — no Storage call there", async () => {
    expect(await reserveUploadIntent(TX, intent)).toEqual(reservation);
    expect(db.reserveUpload).toHaveBeenCalledExactlyOnceWith(TX, {
      purpose: 'platform.user_import',
      owner: intent.owner,
      name: 'موظفو_الرياض.CSV',
      declaredType: 'text/csv',
      size: 120,
    });
  });

  it('signs exactly the reserved key, after the commit', async () => {
    const files = storage();
    expect(await signUploadIntent(files, reservation)).toEqual({
      fileId: FILE,
      url: 'https://tms.example/storage/v1/object/upload/sign/k?token=t',
      method: 'PUT',
      contentType: 'text/csv',
      maxBytes: 20971520,
      expiresAt: new Date('2026-10-09T08:15:00Z'),
    });
    expect(files.createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith('imports', 'k');
    expect(db.assertNoDatabaseTransaction).toHaveBeenCalledWith('signUploadIntent');
  });

  it('refuses to sign inside a transaction (integration review M1): never reaches Storage', async () => {
    const files = storage();
    db.inTransaction = true;
    await expect(signUploadIntent(files, reservation)).rejects.toThrow(
      /signUploadIntent must run after the transaction commits/,
    );
    expect(files.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses early what the purpose does not allow', async () => {
    const refused = async (overrides: Record<string, unknown>) =>
      reserveUploadIntent(TX, { ...intent, ...overrides }).then(
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
    expect(db.reserveUpload).toHaveBeenCalledTimes(1);
    expect(db.reserveUpload.mock.calls[0]?.[1]).toMatchObject({ declaredType: XLSX });
  });

  it('reports a Storage refusal or outage without its message', async () => {
    const files = storage();
    files.createSignedUploadUrl.mockRejectedValueOnce({
      code: 'STORAGE_FORBIDDEN',
      temporary: false,
    });
    await expect(signUploadIntent(files, reservation)).rejects.toMatchObject({
      code: 'STORAGE_REFUSED',
    });
    files.createSignedUploadUrl.mockRejectedValueOnce({
      code: 'STORAGE_UNAVAILABLE',
      temporary: true,
    });
    await expect(signUploadIntent(files, reservation)).rejects.toMatchObject({
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
    expect(FINAL_STATUSES).toContain('accepted');
    expect(FINAL_STATUSES).not.toContain('scanning');
  });
});

describe('grantDownload (transaction step) and signDownload (after the commit)', () => {
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
  const granted = { bucket: 'imports', objectKey: 'k', name: 'a.csv', ttlSeconds: 60 };

  it("grants and audits in the caller's transaction for the authorized owner — no Storage call there", async () => {
    db.grantFileDownload.mockResolvedValue(grant);
    expect(await grantDownload(TX, ACTOR, request)).toEqual(granted);
    expect(db.grantFileDownload).toHaveBeenCalledWith(TX, request);
    expect(db.insertAuditEvent).toHaveBeenCalledWith(TX, ACTOR, {
      action: 'platform.file.download_granted',
      entityType: 'file',
      entityId: FILE,
      data: { purpose: 'platform.user_import', ttlSeconds: 60 },
    });
  });

  it('signs a URL of the same lifetime after the commit; refuses inside a transaction', async () => {
    const files = storage();
    const before = Date.now();
    const link = await signDownload(files, granted);
    expect(link.url).toContain('download=a.csv');
    expect(link.name).toBe('a.csv');
    expect(link.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(files.createSignedDownloadUrl).toHaveBeenCalledExactlyOnceWith(
      'imports',
      'k',
      60,
      'a.csv',
    );
    db.inTransaction = true;
    await expect(signDownload(files, granted)).rejects.toThrow(
      /signDownload must run after the transaction commits/,
    );
    expect(files.createSignedDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("names the download by the type found by content, never by the uploader's extension", async () => {
    db.grantFileDownload.mockResolvedValue({ ...grant, name: 'payroll.hta' });
    const named = await grantDownload(TX, ACTOR, request);
    expect(named.name).toBe('payroll.csv');
    const files = storage();
    await signDownload(files, named);
    expect(files.createSignedDownloadUrl).toHaveBeenCalledWith('imports', 'k', 60, 'payroll.csv');
  });

  it('does not audit media downloads; refuses bad requests and Storage refusals', async () => {
    db.grantFileDownload.mockResolvedValue({ ...grant, auditDownloads: false, ttlSeconds: 300 });
    await grantDownload(TX, ACTOR, request);
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
    for (const bad of [
      { ...request, fileId: 'not-a-uuid' },
      { ...request, purpose: 'toString' as never },
      { ...request, owner: { ...request.owner, entityId: 'x' } },
      { ...request, owner: { ...request.owner, module: 'Platform' } },
      { ...request, owner: { ...request.owner, entityType: '../x' } },
    ]) {
      await expect(grantDownload(TX, ACTOR, bad)).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
      });
    }
    expect(db.grantFileDownload).toHaveBeenCalledTimes(1);
    const files = storage();
    files.createSignedDownloadUrl.mockRejectedValueOnce(new Error('x'));
    await expect(signDownload(files, granted)).rejects.toMatchObject({
      code: 'STORAGE_REFUSED',
    });
  });
});

describe('fileResult: expected refusals as error results (integration review L-b)', () => {
  it('passes a value through; Storage and domain refusals become application errors', async () => {
    expect(await fileResult(Promise.resolve(1))).toEqual({ ok: true, value: 1 });
    const files = storage();
    files.createSignedUploadUrl.mockRejectedValueOnce({ temporary: true });
    expect(await fileResult(signUploadIntent(files, reservation))).toMatchObject({
      ok: false,
      error: { code: 'FILE_STORAGE_UNAVAILABLE', status: 503, expose: true },
    });
    files.createSignedUploadUrl.mockRejectedValueOnce({ temporary: false });
    expect(await fileResult(signUploadIntent(files, reservation))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', status: 403 },
    });
    expect(await fileResult(reserveUploadIntent(TX, { ...intent, size: 0 }))).toMatchObject({
      ok: false,
      error: { code: 'FILE_TOO_LARGE', status: 422, messageKey: 'files.errors.tooLarge' },
    });
    expect(
      await fileResult(reserveUploadIntent(TX, { ...intent, declaredName: 'run.exe' })),
    ).toMatchObject({ ok: false, error: { code: 'FILE_TYPE_NOT_ALLOWED' } });
    for (const [code, expected] of [
      ['TOO_MANY_PENDING_UPLOADS', 'FILE_TOO_MANY_UPLOADS'],
      ['FILE_NOT_CLEAN', 'FILE_NOT_READY'],
      ['OBJECT_NOT_UPLOADED', 'FILE_NOT_UPLOADED'],
      ['UPLOAD_EXPIRED', 'FILE_UPLOAD_EXPIRED'],
      ['FILE_BUSY', 'FILE_BUSY'],
      ['FILE_NOT_FOUND', 'NOT_FOUND'],
    ] as const) {
      const result = await fileResult(Promise.reject(new db.DomainError(code)));
      expect(!result.ok && result.error.code, code).toBe(expected);
    }
    expect(Object.keys(FileErrors).sort()).toEqual([
      'FILE_BUSY',
      'FILE_NOT_READY',
      'FILE_NOT_UPLOADED',
      'FILE_STORAGE_UNAVAILABLE',
      'FILE_TOO_LARGE',
      'FILE_TOO_MANY_UPLOADS',
      'FILE_TYPE_NOT_ALLOWED',
      'FILE_UPLOAD_EXPIRED',
    ]);
  });

  it('rethrows bugs and outages: a purpose or owner a module must never pass, the transaction guard, any other error', async () => {
    await expect(
      fileResult(reserveUploadIntent(TX, { ...intent, purpose: 'constructor' as never })),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PURPOSE' });
    await expect(
      fileResult(reserveUploadIntent(TX, { ...intent, owner: { ...intent.owner, entityId: 'x' } })),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_DATA' });
    db.inTransaction = true;
    await expect(fileResult(signUploadIntent(storage(), reservation))).rejects.toThrow(
      /must run after the transaction commits/,
    );
    await expect(fileResult(Promise.reject(new TypeError('x')))).rejects.toThrow(TypeError);
  });
});
