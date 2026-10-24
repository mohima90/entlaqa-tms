import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  IMPORTER_NOT_ALLOWED,
  applyUserImportBatch,
  classifyUserImport,
  claimUserImportWork,
  clearUserImportSchedule,
  deleteUserImportStaged,
  finishUserImportRows,
  jobFileStatus,
  loadUserImportForJob,
  loadMemberNamesByEmail,
  loadUserImportHeaders,
  loadUserImportReportRows,
  markUserImportPurged,
  recheckUserImport,
  releaseNextUserImportInvitation,
  releaseUserImportLease,
  renewUserImportLease,
  saveUserImportColumns,
  scheduleUserImportInvitations,
  setUserImportStatus,
  stageUserImportRows,
  undoUserImportBatch,
  userImportReviewCounts,
  userImportUndoCounts,
} from './user-imports';

const dialect = new PgDialect();
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const LEASE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

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

describe('user imports, worker side', () => {
  it('claims the next step, or nothing', async () => {
    expect(
      await claimUserImportWork(
        fakeTx([{ tenant_id: 't1', import_id: ID, step: 'validate', lease_token: LEASE }]).tx,
      ),
    ).toEqual({ tenantId: 't1', importId: ID, step: 'validate', leaseToken: LEASE });
    expect(await claimUserImportWork(fakeTx([]).tx)).toBeNull();
    expect(await claimUserImportWork(fakeTx([{ import_id: null }]).tx)).toBeNull();
    expect(
      await claimUserImportWork(
        fakeTx([{ tenant_id: 't', import_id: ID, step: 'dance', lease_token: LEASE }]).tx,
      ),
    ).toBeNull();
  });

  it('loads the import under its lease, with the file and the importer’s language', async () => {
    const fake = fakeTx([
      {
        id: ID,
        status: 'validating',
        created_by: 'u1',
        file_id: 'f1',
        file_name: 'staff.csv',
        sheets: [{ name: '' }],
        sheet_index: 0,
        mapping: { '0': 'email' },
        options: { existing: 'skip', defaultRole: 'learner', invitations: 'hold' },
        rows_total: '0',
        rows_done: 0,
        stop_requested: false,
        review_file_id: null,
        report_file_id: null,
        confirmed_at: '2026-10-10T09:00:00Z',
        failures: 2,
        file_status: 'clean',
        file_status_reason: null,
        file_type: 'text/csv',
        importer_locale: 'en',
        importer_may_import: true,
        step: 'validate',
      },
    ]);
    const view = await loadUserImportForJob(fake.tx, ID, LEASE);
    expect(view).toMatchObject({
      id: ID,
      status: 'validating',
      step: 'validate',
      fileType: 'text/csv',
      options: { existing: 'skip', defaultRole: 'learner', invitations: 'hold' },
      confirmedAt: new Date('2026-10-10T09:00:00Z'),
      failures: 2,
      importerLocale: 'en',
      importerMayImport: true,
    });
    expect(fake.executed[0]?.sql).toContain('for update of i');
    expect(fake.executed[0]?.sql).toContain(
      'private.user_import_actor_may_import(i.tenant_id, i.created_by)',
    );
    expect(fake.executed[0]?.params).toEqual([ID, LEASE]);
    expect(await loadUserImportForJob(fakeTx([]).tx, ID, LEASE)).toBeNull();
    const bare = await loadUserImportForJob(
      fakeTx([
        {
          id: ID,
          status: 'uploaded',
          created_by: 'u1',
          file_id: 'f1',
          file_name: 'a.csv',
          sheets: null,
          sheet_index: null,
          mapping: null,
          options: null,
          rows_total: 0,
          rows_done: 0,
          stop_requested: null,
          review_file_id: null,
          report_file_id: null,
          confirmed_at: new Date('2026-10-10T09:00:00Z'),
          failures: 0,
          file_status: null,
          file_status_reason: null,
          file_type: null,
          importer_locale: 'ar',
          step: null,
        },
      ]).tx,
      ID,
      LEASE,
    );
    expect(bare).toMatchObject({
      step: null,
      sheets: [],
      options: null,
      importerLocale: 'ar',
      importerMayImport: false,
    });
    expect(bare?.confirmedAt).toEqual(new Date('2026-10-10T09:00:00Z'));
  });

  it('renews and releases the lease, backing off after a failure', async () => {
    expect(await renewUserImportLease(fakeTx([{ id: ID }]).tx, ID, LEASE)).toBe(true);
    expect(await renewUserImportLease(fakeTx([]).tx, ID, LEASE)).toBe(false);
    const retry = fakeTx([{ failures: 3 }]);
    expect(await releaseUserImportLease(retry.tx, ID, LEASE, 'retry')).toBe(3);
    expect(retry.executed[0]?.sql).toContain('power(2, least(failures, 10))');
    expect(retry.executed[0]?.params.slice(0, 2)).toEqual(['retry', 'retry']);
    const done = fakeTx([]);
    expect(await releaseUserImportLease(done.tx, ID, LEASE, 'done')).toBe(0);
    // A step that set a later next attempt (the send clock, a capped organization) keeps it.
    expect(done.executed[0]?.sql).toContain('greatest(now(), next_attempt_at)');
  });

  it('moves the import with what the step found', async () => {
    const fake = fakeTx([{ id: ID }]);
    expect(
      await setUserImportStatus(fake.tx, ID, ['validating'], 'review', {
        failureCode: null,
        sheets: [{ name: 'S' }],
        rowsTotal: 5,
        reviewCounts: { total: 5 },
        resultCounts: { added: 1 },
        reviewFileId: 'r1',
        reportFileId: null,
        reportCode: 'REPORT_FAILED',
        undoCounts: { removed: 2 },
        checkpoint: 0,
      }),
    ).toBe(true);
    const query = fake.executed[0];
    expect(query?.sql).toContain('status in ($');
    for (const column of [
      'failure_code',
      'sheets',
      'rows_total',
      'review_counts',
      'result_counts',
      'review_file_id',
      'report_file_id',
      'report_code',
      'checkpoint',
    ]) {
      expect(query?.sql).toContain(`${column} = `);
    }
    expect(query?.sql).toContain("jsonb_build_object('undo', ");
    expect(query?.params).toEqual(
      expect.arrayContaining([
        'review',
        'validating',
        5,
        'r1',
        0,
        'REPORT_FAILED',
        '{"removed":2}',
      ]),
    );
    const plain = fakeTx([]);
    expect(await setUserImportStatus(plain.tx, ID, ['queued', 'checking'], 'stopped')).toBe(false);
    expect(plain.executed[0]?.sql).not.toContain('failure_code');
  });

  it('reads the names of active members by e-mail (rows that update them, PO 17 Oct 2026)', async () => {
    expect((await loadMemberNamesByEmail(fakeTx().tx, [])).size).toBe(0);
    const fake = fakeTx([
      {
        email: 'm@x.test',
        first_name_ar: 'منيرة',
        family_name_ar: 'الزهراني',
        first_name_en: null,
      },
    ]);
    const found = await loadMemberNamesByEmail(fake.tx, ['m@x.test', 'm@x.test', 'n@x.test']);
    expect(found.get('m@x.test')).toEqual({
      first_name_ar: 'منيرة',
      father_name_ar: null,
      grandfather_name_ar: null,
      family_name_ar: 'الزهراني',
      first_name_en: null,
      father_name_en: null,
      grandfather_name_en: null,
      family_name_en: null,
    });
    expect(found.has('n@x.test')).toBe(false);
    expect(fake.executed[0]?.sql).toContain("m.status = 'active'");
    expect(fake.executed[0]?.sql).toContain('p.removed_at is null');
    expect(fake.executed[0]?.params).toEqual([JSON.stringify(['m@x.test', 'n@x.test'])]);
  });

  it('stages columns and rows in batches through JSON records', async () => {
    const columns = Array.from({ length: 501 }, (_v, i) => ({
      sheetIndex: 0,
      index: i % 200,
      header: `h${String(i)}`,
      samples: ['x'],
    }));
    const fake = fakeTx([], []);
    await saveUserImportColumns(fake.tx, ID, columns);
    expect(fake.executed).toHaveLength(2);
    expect(fake.executed[0]?.sql).toContain('jsonb_to_recordset');
    const rows = fakeTx([]);
    await stageUserImportRows(rows.tx, ID, [
      { rowNumber: 2, cells: { email: 'A@x.test' }, data: { email: 'a@x.test' }, formatIssues: [] },
    ]);
    expect(JSON.parse(String(rows.executed[0]?.params[1]))).toEqual([
      { n: 2, c: { email: 'A@x.test' }, d: { email: 'a@x.test' }, f: [] },
    ]);
    const none = fakeTx();
    await stageUserImportRows(none.tx, ID, []);
    expect(none.executed).toHaveLength(0);
  });

  it('deletes staged data and marks the purge', async () => {
    const rowsOnly = fakeTx();
    await deleteUserImportStaged(rowsOnly.tx, ID, 'rows');
    expect(rowsOnly.executed).toHaveLength(1);
    const purge = fakeTx();
    await markUserImportPurged(purge.tx, ID);
    expect(purge.executed.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'delete from platform.user_import_rows',
      'delete from platform.user_import_columns',
      'update platform.user_imports set',
    ]);
  });

  it('reads headers, counts and runs the database steps', async () => {
    expect(
      await loadUserImportHeaders(fakeTx([{ column_index: '1', header: 'Email' }]).tx, ID, 0),
    ).toEqual(new Map([[1, 'Email']]));
    const classify = fakeTx([], [{ present: true }], [], [{ counts: { total: 2 } }]);
    expect(await classifyUserImport(classify.tx, ID)).toEqual({ total: 2 });
    expect(classify.executed[0]?.sql).toContain('private.user_import_classify');
    // The cost-centre step once its migration is applied (WP-HR-01), not before.
    expect(classify.executed[2]?.sql).toMatch(
      /select private\.user_import_classify_cost_centres\(/,
    );
    const before = fakeTx([], [{ present: false }], [{ counts: { total: 1 } }]);
    expect(await classifyUserImport(before.tx, ID)).toEqual({ total: 1 });
    expect(
      before.executed.some((q) =>
        q.sql.includes('select private.user_import_classify_cost_centres('),
      ),
    ).toBe(false);
    expect(await userImportReviewCounts(fakeTx([]).tx, ID)).toEqual({});
    expect(await recheckUserImport(fakeTx([{ changed: '4' }]).tx, ID)).toBe(4);
    expect(await recheckUserImport(fakeTx([]).tx, ID)).toBe(0);
    expect(await applyUserImportBatch(fakeTx([{ done: 500 }]).tx, ID, 500)).toBe(500);
    await expect(
      applyUserImportBatch(
        fakeTx(Object.assign(new Error('x'), { cause: { code: 'JU001', message: '' } })).tx,
        ID,
        500,
      ),
    ).rejects.toMatchObject({ code: IMPORTER_NOT_ALLOWED });
    const other = Object.assign(new Error('x'), { cause: { code: '40001', message: '' } });
    await expect(applyUserImportBatch(fakeTx(other).tx, ID, 500)).rejects.toBe(other);
    const finish = fakeTx([], [{ counts: { added: 1 } }]);
    expect(await finishUserImportRows(finish.tx, ID)).toEqual({ added: 1 });
    expect(await finishUserImportRows(fakeTx([], []).tx, ID)).toEqual({});
    expect(await scheduleUserImportInvitations(fakeTx([{ scheduled: 3 }]).tx, ID, 1)).toBe(3);
    // The invitation guard refuses an importer who may no longer invite (42501): the run fails.
    await expect(
      scheduleUserImportInvitations(
        fakeTx(Object.assign(new Error('x'), { cause: { code: '42501', message: '' } })).tx,
        ID,
        1,
      ),
    ).rejects.toMatchObject({ code: IMPORTER_NOT_ALLOWED });
    const deadlock = Object.assign(new Error('x'), { cause: { code: '40P01', message: '' } });
    await expect(scheduleUserImportInvitations(fakeTx(deadlock).tx, ID, 1)).rejects.toBe(deadlock);
    const sending = { intervalMs: 1000, dailyCap: 5000, trialDailyCap: 200 };
    const release = fakeTx([{ state: 'wait', not_before: '2026-10-10T09:00:01Z' }]);
    expect(await releaseNextUserImportInvitation(release.tx, ID, sending)).toEqual({
      state: 'wait',
      notBefore: new Date('2026-10-10T09:00:01Z'),
    });
    expect(release.executed[0]?.sql).toContain('private.user_import_release_next(');
    expect(release.executed[0]?.params).toEqual([ID, 1, 5000, 200]);
    expect(
      await releaseNextUserImportInvitation(
        fakeTx([{ state: 'released', not_before: null }]).tx,
        ID,
        sending,
      ),
    ).toEqual({ state: 'released', notBefore: null });
    expect(
      await releaseNextUserImportInvitation(fakeTx([{ state: 'odd' }]).tx, ID, sending),
    ).toEqual({ state: 'none', notBefore: null });
    expect(await undoUserImportBatch(fakeTx([{ done: '0' }]).tx, ID, 500)).toBe(0);
    expect(await undoUserImportBatch(fakeTx([{ done: -1 }]).tx, ID, 500)).toBe(-1);
    expect(await userImportUndoCounts(fakeTx([{ undo_result: 'removed', n: '2' }]).tx, ID)).toEqual(
      { removed: 2 },
    );
    expect(await clearUserImportSchedule(fakeTx([{ id: 'a' }, { id: 'b' }]).tx, ID)).toBe(2);
    expect(await jobFileStatus(fakeTx([{ status: 'clean' }]).tx, 'f1')).toBe('clean');
    expect(await jobFileStatus(fakeTx([]).tx, 'f1')).toBeNull();
  });

  it('pages the rows of the review list and of the error report', async () => {
    const review = fakeTx([
      {
        row_number: 3,
        cells: null,
        review_kind: 'error',
        result: null,
        issues: [],
        result_issues: null,
      },
    ]);
    expect(await loadUserImportReportRows(review.tx, ID, 'review', 0, 1000)).toEqual([
      { rowNumber: 3, cells: {}, kind: 'error', result: null, issues: [], resultIssues: null },
    ]);
    expect(review.executed[0]?.sql).toContain("r.review_kind in ('error', 'skip')");
    const result = fakeTx([]);
    await loadUserImportReportRows(result.tx, ID, 'result', 10, 1000);
    expect(result.executed[0]?.sql).toContain("r.result in ('failed', 'not_processed', 'skipped')");
    expect(result.executed[0]?.params).toEqual([ID, 10, 1000]);
  });
});
