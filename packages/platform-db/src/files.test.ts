import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import {
  FILE_EVENTS,
  confirmFileUpload,
  deleteFileRecord,
  fileErrorOf,
  getFileStatus,
  grantFileDownload,
  markFileUsed,
  reserveUpload,
} from './files';

const dialect = new PgDialect();
const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const ENTITY = '0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a';
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/** Answers each statement with the next result (the last one repeats); `fail` throws instead. */
function fakeTx(...results: (unknown[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query));
        const result = results[Math.min(executed.length, results.length) - 1] ?? [];
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    } as never,
  };
}

const pg = (code: string) => Object.assign(new Error('database refusal'), { code });

const fileRow = (status: string) => ({
  id: FILE,
  status,
  status_reason: null,
  purpose: 'platform.user_import',
  owner_module: 'platform',
  owner_entity_type: 'user_import',
  owner_entity_id: ENTITY,
  original_name: 'موظفو الرياض.csv',
  declared_mime: 'text/csv',
  detected_mime: status === 'clean' ? 'text/csv' : null,
  size_bytes: status === 'clean' ? '120' : null,
  sha256: status === 'clean' ? 'ab'.repeat(32) : null,
  created_at: '2026-10-09T08:00:00.000Z',
  scanned_at: status === 'clean' ? new Date('2026-10-09T08:01:00.000Z') : null,
  used_at: null,
});

describe('fileErrorOf', () => {
  it('maps the migration SQLSTATEs and CHECK refusals to DomainError codes', () => {
    const cases: [string, string][] = [
      ['JF001', 'TYPE_NOT_ALLOWED'],
      ['JF002', 'TOO_LARGE'],
      ['JF003', 'UNKNOWN_PURPOSE'],
      ['JF004', 'FILE_NOT_FOUND'],
      ['JF005', 'OBJECT_NOT_UPLOADED'],
      ['JF006', 'UPLOAD_EXPIRED'],
      ['JF007', 'TOO_MANY_PENDING_UPLOADS'],
      ['JF008', 'FILE_NOT_CLEAN'],
      ['JF009', 'FILE_BUSY'],
      ['23514', 'INVALID_FILE_DATA'],
    ];
    for (const [sqlstate, code] of cases) {
      const mapped = fileErrorOf(pg(sqlstate));
      expect(mapped).toBeInstanceOf(DomainError);
      expect((mapped as DomainError).code).toBe(code);
    }
  });

  it('returns anything else unchanged (wrapped causes are found)', () => {
    const other = pg('42501');
    expect(fileErrorOf(other)).toBe(other);
    const plain = new Error('x');
    expect(fileErrorOf(plain)).toBe(plain);
    const wrapped = new Error('query failed', { cause: pg('JF004') });
    expect((fileErrorOf(wrapped) as DomainError).code).toBe('FILE_NOT_FOUND');
  });
});

describe('reserveUpload', () => {
  it('reserves through private.create_file_upload and returns the key and window', async () => {
    const fake = fakeTx([
      {
        id: FILE,
        bucket: 'imports',
        object_key: `${TENANT}/platform/user_import/${ENTITY}/${FILE}`,
        upload_expires_at: '2026-10-09T08:15:00.000Z',
        max_bytes: '20971520',
      },
    ]);
    const reserved = await reserveUpload(fake.tx, {
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
      name: 'staff.csv',
      declaredType: 'text/csv',
      size: 120,
    });
    expect(reserved).toEqual({
      fileId: FILE,
      bucket: 'imports',
      objectKey: `${TENANT}/platform/user_import/${ENTITY}/${FILE}`,
      uploadExpiresAt: new Date('2026-10-09T08:15:00.000Z'),
      maxBytes: 20971520,
    });
    expect(fake.executed[0]?.sql).toContain('private.create_file_upload');
    expect(fake.executed[0]?.params).toEqual([
      'platform.user_import',
      'platform',
      'user_import',
      ENTITY,
      'staff.csv',
      'text/csv',
      120,
    ]);
  });

  it('maps refusals and fails loudly without a row', async () => {
    const input = {
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
      name: 'a.exe',
      declaredType: 'application/x-msdownload',
      size: 1,
    };
    await expect(reserveUpload(fakeTx(pg('JF001')).tx, input)).rejects.toMatchObject({
      code: 'TYPE_NOT_ALLOWED',
    });
    await expect(reserveUpload(fakeTx([]).tx, input)).rejects.toThrow('no row returned');
  });
});

describe('getFileStatus', () => {
  it('returns the view of a visible file, null otherwise', async () => {
    const view = await getFileStatus(fakeTx([fileRow('clean')]).tx, FILE);
    expect(view).toEqual({
      fileId: FILE,
      status: 'clean',
      reason: null,
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
      name: 'موظفو الرياض.csv',
      declaredType: 'text/csv',
      detectedType: 'text/csv',
      size: 120,
      sha256: 'ab'.repeat(32),
      createdAt: new Date('2026-10-09T08:00:00.000Z'),
      scannedAt: new Date('2026-10-09T08:01:00.000Z'),
      usedAt: null,
    });
    const pending = await getFileStatus(fakeTx([fileRow('pending_upload')]).tx, FILE);
    expect(pending).toMatchObject({ status: 'pending_upload', size: null, scannedAt: null });
    expect(await getFileStatus(fakeTx([]).tx, FILE)).toBeNull();
  });
});

describe('confirmFileUpload', () => {
  it('emits file.uploaded the first time a pending upload becomes uploaded', async () => {
    const fake = fakeTx([fileRow('pending_upload')], [{ status: 'uploaded' }], []);
    expect(await confirmFileUpload(fake.tx, FILE)).toBe('uploaded');
    expect(fake.executed).toHaveLength(3);
    expect(fake.executed[1]?.sql).toContain('private.confirm_file_upload');
    expect(fake.executed[2]?.sql).toContain('platform.event_outbox');
    expect(fake.executed[2]?.params).toContain(FILE_EVENTS.uploaded);
    // Owner only, never the file's name.
    expect(JSON.stringify(fake.executed[2]?.params)).not.toContain('الرياض');
  });

  it('emits nothing when repeated, rejected at once or refused', async () => {
    const again = fakeTx([fileRow('uploaded')], [{ status: 'uploaded' }]);
    expect(await confirmFileUpload(again.tx, FILE)).toBe('uploaded');
    expect(again.executed).toHaveLength(2);
    const rejected = fakeTx([fileRow('pending_upload')], [{ status: 'rejected' }]);
    expect(await confirmFileUpload(rejected.tx, FILE)).toBe('rejected');
    expect(rejected.executed).toHaveLength(2);
    await expect(
      confirmFileUpload(fakeTx([fileRow('pending_upload')], pg('JF005')).tx, FILE),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_UPLOADED' });
    await expect(confirmFileUpload(fakeTx([], []).tx, FILE)).rejects.toThrow('no status');
  });
});

describe('grantFileDownload, deleteFileRecord, markFileUsed', () => {
  it('grants a download of a clean file of the authorized owner and purpose', async () => {
    const request = {
      fileId: FILE,
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: ENTITY },
    };
    const fake = fakeTx([
      {
        bucket: 'imports',
        object_key: 'k',
        original_name: 'a.csv',
        detected_mime: 'text/csv',
        ttl_seconds: 60,
        audit_downloads: true,
      },
    ]);
    const grant = await grantFileDownload(fake.tx, request);
    expect(grant).toEqual({
      bucket: 'imports',
      objectKey: 'k',
      name: 'a.csv',
      detectedType: 'text/csv',
      ttlSeconds: 60,
      auditDownloads: true,
    });
    // The owner and purpose go to the database, which checks them (never trusted from the file id alone).
    expect(fake.executed[0]?.sql).toContain('private.grant_file_download($1::uuid, $2,');
    expect(fake.executed[0]?.params).toEqual([
      FILE,
      'platform.user_import',
      'platform',
      'user_import',
      ENTITY,
    ]);
    await expect(grantFileDownload(fakeTx(pg('JF008')).tx, request)).rejects.toMatchObject({
      code: 'FILE_NOT_CLEAN',
    });
    await expect(grantFileDownload(fakeTx(pg('JF004')).tx, request)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
    await expect(grantFileDownload(fakeTx([]).tx, request)).rejects.toThrow('no row returned');
  });

  it('deletes and marks use, reporting whether anything changed', async () => {
    expect(await deleteFileRecord(fakeTx([{ deleted: true }]).tx, FILE)).toBe(true);
    expect(await deleteFileRecord(fakeTx([{ deleted: false }]).tx, FILE)).toBe(false);
    await expect(deleteFileRecord(fakeTx(pg('JF009')).tx, FILE)).rejects.toMatchObject({
      code: 'FILE_BUSY',
    });
    expect(await markFileUsed(fakeTx([{ marked: true }]).tx, FILE)).toBe(true);
    expect(await markFileUsed(fakeTx([]).tx, FILE)).toBe(false);
    await expect(markFileUsed(fakeTx(pg('JF004')).tx, FILE)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });
});
