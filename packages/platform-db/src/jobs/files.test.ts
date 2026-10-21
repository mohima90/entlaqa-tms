import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  claimFileHousekeeping,
  claimFileScan,
  claimOrphanObjects,
  createGeneratedFile,
  finishFileHousekeeping,
  finishFileScan,
  finishGeneratedFile,
  insertSystemAuditEvent,
  loadCleanFile,
  lockFileHousekeeping,
  retryFileScan,
} from './files';

const dialect = new PgDialect();
const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

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

describe('scan helpers', () => {
  it('leases the next file to scan, or nothing', async () => {
    const lease = await claimFileScan(
      fakeTx([
        {
          id: FILE,
          tenant_id: TENANT,
          bucket: 'imports',
          object_key: 'k',
          purpose: 'platform.user_import',
          declared_mime: 'text/csv',
          size_bytes: '120',
          max_bytes: '20971520',
          allowed_types: ['text/csv'],
          attempts: 1,
        },
      ]).tx,
    );
    expect(lease).toEqual({
      fileId: FILE,
      tenantId: TENANT,
      bucket: 'imports',
      objectKey: 'k',
      purpose: 'platform.user_import',
      declaredType: 'text/csv',
      reportedSize: 120,
      maxBytes: 20971520,
      allowedTypes: ['text/csv'],
      attempt: 1,
    });
    const unknownSize = await claimFileScan(
      fakeTx([
        {
          id: FILE,
          tenant_id: TENANT,
          bucket: 'imports',
          object_key: 'k',
          purpose: 'p',
          declared_mime: 'text/csv',
          size_bytes: null,
          max_bytes: 10,
          allowed_types: [],
          attempts: 2,
        },
      ]).tx,
    );
    expect(unknownSize?.reportedSize).toBeNull();
    expect(await claimFileScan(fakeTx([]).tx)).toBeNull();
  });

  it('records each outcome with only its own fields', async () => {
    const clean = fakeTx([{ finished: true }]);
    expect(
      await finishFileScan(clean.tx, FILE, {
        outcome: 'clean',
        detectedType: 'text/csv',
        size: 120,
        sha256: 'ab'.repeat(32),
        engine: 'ClamAV 1.5.4',
        signatures: '28137',
      }),
    ).toBe(true);
    expect(clean.executed[0]?.params).toEqual([
      FILE,
      'clean',
      'text/csv',
      120,
      'ab'.repeat(32),
      'ClamAV 1.5.4',
      '28137',
      null,
      null,
    ]);
    const infected = fakeTx([{ finished: false }]);
    expect(
      await finishFileScan(infected.tx, FILE, {
        outcome: 'infected',
        detectedType: null,
        size: 68,
        sha256: 'cd'.repeat(32),
        engine: 'ClamAV 1.5.4',
        signatures: '28137',
        finding: 'Eicar-Test-Signature',
      }),
    ).toBe(false);
    expect(infected.executed[0]?.params.slice(7)).toEqual(['Eicar-Test-Signature', null]);
    const rejected = fakeTx([]);
    expect(
      await finishFileScan(rejected.tx, FILE, { outcome: 'rejected', reason: 'too_large' }),
    ).toBe(false);
    expect(rejected.executed[0]?.params).toEqual([
      FILE,
      'rejected',
      null,
      null,
      null,
      null,
      null,
      null,
      'too_large',
    ]);
    const encrypted = fakeTx([{ finished: true }]);
    await finishFileScan(encrypted.tx, FILE, {
      outcome: 'rejected',
      reason: 'encrypted',
      finding: 'Heuristics.Encrypted.Zip',
      engine: 'ClamAV 1.5.4',
    });
    expect(encrypted.executed[0]?.params.slice(7)).toEqual([
      'Heuristics.Encrypted.Zip',
      'encrypted',
    ]);
  });

  it('schedules retries', async () => {
    expect(await retryFileScan(fakeTx([{ state: 'waiting' }]).tx, FILE, 'scanner')).toBe('waiting');
    expect(await retryFileScan(fakeTx([{ state: 'error' }]).tx, FILE, 'processing')).toBe('error');
    const crash = fakeTx([{ state: 'crashed' }]);
    expect(await retryFileScan(crash.tx, FILE, 'crash')).toBe('crashed');
    expect(crash.executed[0]?.params).toEqual([FILE, 'crash']);
    await expect(retryFileScan(fakeTx([]).tx, FILE, 'scanner')).rejects.toThrow('no answer');
  });
});

describe('housekeeping helpers', () => {
  it('leases due work and refuses unknown actions', async () => {
    const fake = fakeTx([
      { id: FILE, tenant_id: TENANT, bucket: 'imports', object_key: 'k', action: 'purge' },
    ]);
    expect(await claimFileHousekeeping(fake.tx, 50)).toEqual([
      { fileId: FILE, tenantId: TENANT, bucket: 'imports', objectKey: 'k', action: 'purge' },
    ]);
    expect(fake.executed[0]?.params).toEqual([50]);
    await expect(
      claimFileHousekeeping(
        fakeTx([{ id: FILE, tenant_id: TENANT, bucket: 'b', object_key: 'k', action: 'drop' }]).tx,
        1,
      ),
    ).rejects.toThrow('unknown action');
  });

  it('records the Storage work', async () => {
    expect(await finishFileHousekeeping(fakeTx([{ done: true }]).tx, FILE, 'quarantine')).toBe(
      true,
    );
    expect(await finishFileHousekeeping(fakeTx([]).tx, FILE, 'remove_object')).toBe(false);
  });

  it('locks a file for its Storage work only while the action is still due', async () => {
    const fake = fakeTx([{ due: true }]);
    expect(await lockFileHousekeeping(fake.tx, FILE, 'purge')).toBe(true);
    expect(fake.executed[0]?.params).toEqual([FILE, 'purge']);
    expect(await lockFileHousekeeping(fakeTx([{ due: false }]).tx, FILE, 'purge')).toBe(false);
    expect(await lockFileHousekeeping(fakeTx([]).tx, FILE, 'quarantine')).toBe(false);
  });

  it('lists orphan objects with the totals', async () => {
    const fake = fakeTx([
      { bucket: 'generated', object_key: 'k', orphans: '612', objects: '9000' },
    ]);
    expect(await claimOrphanObjects(fake.tx, 100)).toEqual({
      orphans: [{ bucket: 'generated', objectKey: 'k' }],
      totalOrphans: 612,
      totalObjects: 9000,
    });
    expect(fake.executed[0]?.params).toEqual([100]);
    expect(await claimOrphanObjects(fakeTx([]).tx, 100)).toEqual({
      orphans: [],
      totalOrphans: 0,
      totalObjects: 0,
    });
  });
});

describe('clean files and generated files', () => {
  it('loads a clean file for a job, or null', async () => {
    expect(
      await loadCleanFile(
        fakeTx([{ bucket: 'imports', object_key: 'k', size_bytes: '5', sha256: 'h' }]).tx,
        FILE,
      ),
    ).toEqual({ bucket: 'imports', objectKey: 'k', size: 5, sha256: 'h' });
    expect(await loadCleanFile(fakeTx([]).tx, FILE)).toBeNull();
  });

  it('asks for status clean only: an accepted (unscanned branding) file is never a job input (review M3)', async () => {
    const fake = fakeTx([]);
    await loadCleanFile(fake.tx, FILE);
    const query = fake.executed[0]?.sql ?? '';
    expect(query).toMatch(/status = 'clean'/);
    expect(query).not.toMatch(/accepted|status in/);
    expect(query).toMatch(/deleted_at is null and purged_at is null/);
  });

  it('reserves and finishes a generated file; maps refusals', async () => {
    const input = {
      purpose: 'platform.user_import_report',
      owner: { module: 'platform', entityType: 'user_import', entityId: FILE },
      name: 'errors.csv',
      type: 'text/csv',
      size: 10,
      forUserId: null,
    };
    const fake = fakeTx([{ id: FILE, bucket: 'generated', object_key: 'k' }]);
    expect(await createGeneratedFile(fake.tx, input)).toEqual({
      fileId: FILE,
      bucket: 'generated',
      objectKey: 'k',
    });
    expect(fake.executed[0]?.params.at(-1)).toBeNull();
    await expect(
      createGeneratedFile(fakeTx(Object.assign(new Error('x'), { code: 'JF002' })).tx, input),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(createGeneratedFile(fakeTx([]).tx, input)).rejects.toThrow('no row returned');
    expect(await finishGeneratedFile(fakeTx([{ done: true }]).tx, FILE, 10, 'h')).toBe(true);
    expect(await finishGeneratedFile(fakeTx([]).tx, FILE, 10, 'h')).toBe(false);
  });

  it('writes a system audit event with the job id from the claims', async () => {
    const fake = fakeTx([]);
    await insertSystemAuditEvent(fake.tx, {
      action: 'platform.file.infected',
      entityType: 'platform.file',
      entityId: FILE,
      data: { finding: 'Eicar-Test-Signature' },
    });
    expect(fake.executed[0]?.sql).toContain('platform.audit_events');
    expect(fake.executed[0]?.sql).toContain("->> 'job_id'");
    expect(fake.executed[0]?.params).toContain(
      JSON.stringify({ finding: 'Eicar-Test-Signature', job: null }),
    );
  });
});
