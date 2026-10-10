import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import {
  cancelUserImport,
  chooseUserImportMapping,
  confirmUserImport,
  createUserImport,
  getHeldInvitationsSummary,
  getRunningUserImport,
  getUndoPreview,
  getUserImport,
  listTemplateUnits,
  listUserImportColumns,
  listUserImportRows,
  listUserImports,
  requestUserImportUndo,
  scheduleHeldInvitations,
  stopUserImport,
  userImportErrorOf,
} from './user-imports';

const dialect = new PgDialect();
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

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

const pg = (code: string, message = '', constraint?: string) =>
  Object.assign(new Error('query failed'), {
    cause: { code, message, ...(constraint ? { constraint_name: constraint } : {}) },
  });

const ROW = {
  id: ID,
  status: 'review',
  failure_code: null,
  file_id: 'f1',
  file_name: 'staff.csv',
  file_size: '120',
  created_by: 'u1',
  importer_ar: 'نورة',
  importer_en: null,
  mine: true,
  sheets: [{ name: 'S', rows: 3, columns: 4, hidden: false, headerRow: 1 }, 'junk', { rows: 'x' }],
  sheet_index: 0,
  mapping: { '0': 'email' },
  options: { existing: 'skip', defaultRole: 'learner', invitations: 'send' },
  review_counts: { total: 3 },
  result_counts: null,
  rows_total: 3,
  rows_done: 0,
  stop_requested_at: null,
  undo_requested_at: null,
  undo_reason: null,
  review_file_id: 'r1',
  report_file_id: null,
  created_at: new Date('2026-10-10T08:00:00Z'),
  updated_at: '2026-10-10T08:05:00Z',
  read_at: '2026-10-10T08:01:00Z',
  reviewed_at: null,
  confirmed_at: null,
  started_at: null,
  finished_at: null,
  undone_at: null,
  review_expires_at: '2026-10-11T08:00:00Z',
  data_purged_at: null,
  file_status: 'clean',
  file_status_reason: null,
  held: '2',
  scheduled: 0,
  sent: '5',
  accepted: '1',
};

describe('user imports, request path', () => {
  it('maps the database refusals', () => {
    const map = (error: unknown) => (userImportErrorOf(error) as DomainError).code;
    expect(map(pg('23505', '', 'user_imports_one_running_uq'))).toBe('ANOTHER_IMPORT_RUNNING');
    expect(map(pg('42501', 'only the person who started an import changes it'))).toBe(
      'NOT_IMPORTER',
    );
    expect(map(pg('42501', 'only an Organization Admin or an HR Manager imports people'))).toBe(
      'NOT_ALLOWED',
    );
    expect(map(pg('23514', 'the review of this import has expired'))).toBe('REVIEW_EXPIRED');
    expect(map(pg('23514', 'this import can no longer be undone'))).toBe('UNDO_EXPIRED');
    expect(map(pg('23514', 'an import cannot be changed this way'))).toBe('IMPORT_STATE_CHANGED');
    const other = pg('23505', '', 'other');
    expect(userImportErrorOf(other)).toBe(other);
    const plain = new Error('x');
    expect(userImportErrorOf(plain)).toBe(plain);
  });

  it('creates an import (the database stamps the importer) and refuses as mapped', async () => {
    const fake = fakeTx([]);
    await createUserImport(fake.tx, { id: ID, fileId: 'f1', fileName: 'staff.csv', fileSize: 120 });
    expect(fake.executed[0]?.sql).toContain('insert into platform.user_imports');
    expect(fake.executed[0]?.params).toEqual([ID, 'f1', 'staff.csv', 120]);
    await expect(
      createUserImport(fakeTx(pg('42501', 'x')).tx, {
        id: ID,
        fileId: 'f1',
        fileName: 'a.csv',
        fileSize: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('reads an import with its sheets, options, file status and invitation counts', async () => {
    const record = await getUserImport(fakeTx([ROW]).tx, ID);
    expect(record).toMatchObject({
      id: ID,
      status: 'review',
      fileSize: 120,
      importerName: { ar: 'نورة', en: null },
      mine: true,
      sheets: [
        { name: 'S', rows: 3, columns: 4, hidden: false, headerRow: 1 },
        { name: '', rows: 0, columns: 0 },
      ],
      sheetIndex: 0,
      options: { existing: 'skip', defaultRole: 'learner', invitations: 'send' },
      reviewCounts: { total: 3 },
      resultCounts: null,
      reviewFileId: 'r1',
      fileStatus: 'clean',
      invitations: { held: 2, scheduled: 0, sent: 5, accepted: 1 },
    });
    expect(record?.updatedAt).toEqual(new Date('2026-10-10T08:05:00Z'));
    expect(await getUserImport(fakeTx([]).tx, ID)).toBeNull();
    const odd = await getUserImport(
      fakeTx([{ ...ROW, options: { existing: 'x' }, sheets: null, sheet_index: null, mine: null }])
        .tx,
      ID,
    );
    expect(odd).toMatchObject({ options: null, sheets: [], sheetIndex: null, mine: false });
  });

  it('lists recent imports and the running one', async () => {
    const fake = fakeTx([ROW, ROW]);
    expect(await listUserImports(fake.tx, 500)).toHaveLength(2);
    expect(fake.executed[0]?.params).toContain(50);
    const running = fakeTx([]);
    expect(await getRunningUserImport(running.tx)).toBeNull();
    expect(running.executed[0]?.sql).toContain(
      "'queued', 'checking', 'importing', 'inviting', 'undoing'",
    );
    expect(await getRunningUserImport(fakeTx([ROW]).tx)).toMatchObject({ id: ID });
  });

  it('summarizes held invitations', async () => {
    expect(
      await getHeldInvitationsSummary(
        fakeTx([
          { import_id: 'i2', file_name: 'b.csv', held: '3' },
          { import_id: 'i1', file_name: 'a.csv', held: 2 },
        ]).tx,
      ),
    ).toEqual({ total: 5, latest: { importId: 'i2', fileName: 'b.csv', held: 3 } });
    expect(await getHeldInvitationsSummary(fakeTx([]).tx)).toEqual({ total: 0, latest: null });
  });

  it('lists the staged columns', async () => {
    expect(
      await listUserImportColumns(
        fakeTx([{ sheet_index: '0', column_index: 2, header: 'Email', samples: ['a@x.test'] }]).tx,
        ID,
      ),
    ).toEqual([{ sheetIndex: 0, index: 2, header: 'Email', samples: ['a@x.test'] }]);
  });

  it('moves the importer’s own import on, and only from the expected status', async () => {
    const fake = fakeTx([{ status: 'mapping', mine: true }], [{ id: ID }], []);
    await chooseUserImportMapping(fake.tx, ID, { sheetIndex: 1, mapping: { '0': 'email' } });
    expect(fake.executed[1]?.sql).toContain("status = 'validating'");
    expect(fake.executed[1]?.params).toEqual([1, '{"0":"email"}', ID]);
    expect(fake.executed[2]?.sql).toContain('insert into platform.event_outbox');

    await expect(cancelUserImport(fakeTx([]).tx, ID)).rejects.toMatchObject({
      code: 'IMPORT_NOT_FOUND',
    });
    await expect(
      cancelUserImport(fakeTx([{ status: 'review', mine: false }]).tx, ID),
    ).rejects.toMatchObject({ code: 'NOT_IMPORTER' });
    await expect(
      stopUserImport(fakeTx([{ status: 'finished', mine: true }]).tx, ID),
    ).rejects.toMatchObject({ code: 'IMPORT_STATE_CHANGED' });
    await expect(
      stopUserImport(fakeTx([{ status: 'importing', mine: true }], []).tx, ID),
    ).rejects.toMatchObject({ code: 'IMPORT_STATE_CHANGED' });
    await expect(
      confirmUserImport(
        fakeTx([{ status: 'review', mine: true }], pg('23505', '', 'user_imports_one_running_uq'))
          .tx,
        ID,
        { existing: 'upsert', defaultRole: 'learner', invitations: 'hold' },
      ),
    ).rejects.toMatchObject({ code: 'ANOTHER_IMPORT_RUNNING' });

    const confirm = fakeTx([{ status: 'review', mine: true }], [{ id: ID }], []);
    await confirmUserImport(confirm.tx, ID, {
      existing: 'update_only',
      defaultRole: 'mentor',
      invitations: 'send',
    });
    expect(confirm.executed[1]?.params).toEqual([
      '{"existing":"update_only","defaultRole":"mentor","invitations":"send"}',
      ID,
    ]);
    const cancel = fakeTx([{ status: 'uploaded', mine: true }], [{ id: ID }]);
    await cancelUserImport(cancel.tx, ID);
    expect(cancel.executed[1]?.sql).toContain("status = 'cancelled'");
    const stop = fakeTx([{ status: 'inviting', mine: true }], [{ id: ID }]);
    await stopUserImport(stop.tx, ID);
    expect(stop.executed[1]?.sql).toContain('stop_requested_at = now()');
    const undo = fakeTx([{ status: 'stopped', mine: true }], [{ id: ID }], []);
    await requestUserImportUndo(undo.tx, ID, 'wrong_data');
    expect(undo.executed[1]?.params).toEqual(['wrong_data', ID]);
    expect(undo.executed[2]?.params).toContain('com.entlaqa.platform.user_import.undo_requested');
  });

  it('previews an undo', async () => {
    expect(
      await getUndoPreview(fakeTx([{ added: '10', accepted: 2, updated: '3' }]).tx, ID),
    ).toEqual({ added: 10, accepted: 2, updated: 3 });
    expect(await getUndoPreview(fakeTx([]).tx, ID)).toEqual({ added: 0, accepted: 0, updated: 0 });
  });

  it('lists a page of rows per view and code', async () => {
    const fake = fakeTx(
      [{ total: '1' }],
      [
        {
          row_number: 14,
          email: 'a@x.test',
          name_ar: 'نورة',
          name_en: null,
          review_kind: 'error',
          issues: [{ c: 'EMAIL_INVALID', s: 'e' }],
          changes: null,
          result: null,
          result_issues: null,
        },
      ],
    );
    const page = await listUserImportRows(fake.tx, ID, {
      view: 'errors',
      code: 'EMAIL_INVALID',
      offset: -5,
      limit: 500,
    });
    expect(page).toEqual({
      total: 1,
      rows: [
        {
          rowNumber: 14,
          email: 'a@x.test',
          nameAr: 'نورة',
          nameEn: null,
          kind: 'error',
          issues: [{ c: 'EMAIL_INVALID', s: 'e' }],
          changes: null,
          result: null,
          resultIssues: null,
        },
      ],
    });
    expect(fake.executed[0]?.sql).toContain("r.review_kind = 'error'");
    expect(fake.executed[0]?.params).toContain('[{"c":"EMAIL_INVALID"}]');
    expect(fake.executed[1]?.params).toEqual(expect.arrayContaining([0, 100]));
    for (const [view, fragment] of [
      ['warnings', `issues @> '[{"s": "w"}]'`],
      ['existing', "r.review_kind = 'existing'"],
      ['skipped', "r.review_kind = 'skip'"],
    ] as const) {
      const other = fakeTx([{ total: 0 }], []);
      await listUserImportRows(other.tx, ID, { view, offset: 0, limit: 25 });
      expect(other.executed[0]?.sql).toContain(fragment);
    }
    const all = fakeTx([], []);
    expect(await listUserImportRows(all.tx, ID, { view: 'all', offset: 0, limit: 25 })).toEqual({
      total: 0,
      rows: [],
    });
  });

  it('schedules held invitations by id or by import, and announces it', async () => {
    const byIds = fakeTx([{ scheduled: 2 }], []);
    expect(await scheduleHeldInvitations(byIds.tx, { ids: ['a', 'b'] }, 1)).toBe(2);
    expect(byIds.executed[0]?.params).toEqual(['{a,b}', 1]);
    expect(byIds.executed[1]?.params).toContain(
      'com.entlaqa.platform.user_import.invitations_scheduled',
    );
    const byImport = fakeTx([{ scheduled: '0' }]);
    expect(await scheduleHeldInvitations(byImport.tx, { importId: ID }, 0)).toBe(0);
    expect(byImport.executed).toHaveLength(1);
    expect(byImport.executed[0]?.params).toEqual([ID, ID, 0]);
    await expect(scheduleHeldInvitations(fakeTx(pg('42501', 'x')).tx, {}, 1)).rejects.toMatchObject(
      { code: 'NOT_ALLOWED' },
    );
  });

  it('lists the template’s departments and branches with codes', async () => {
    expect(
      await listTemplateUnits(
        fakeTx(
          [{ code: 'SAL', name_ar: 'المبيعات', name_en: 'Sales' }],
          [{ code: 'RUH', name_ar: 'فرع الرياض', name_en: null }],
        ).tx,
      ),
    ).toEqual({
      departments: [{ code: 'SAL', nameAr: 'المبيعات', nameEn: 'Sales' }],
      branches: [{ code: 'RUH', nameAr: 'فرع الرياض', nameEn: null }],
    });
  });

  it('DomainError carries the code only', () => {
    expect(new DomainError('X').message).toBe('X');
  });
});
