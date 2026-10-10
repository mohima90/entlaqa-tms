import type { UserImportClaim, UserImportJobView } from '@jadarat/platform-db/jobs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSV_BOM, csvLine } from '../spreadsheet/csv';
import {
  MAX_FAILURES,
  SEND_MAX_WAIT_MS,
  SEND_SHARE,
  USER_IMPORT_TASK,
  codeOf,
  createUserImportTask,
  fileRefusalCode,
} from './task';

const db = vi.hoisted(() => ({
  IMPORTER_NOT_ALLOWED: 'IMPORTER_NOT_ALLOWED',
  claimUserImportWork: vi.fn(),
  loadUserImportForJob: vi.fn(),
  releaseUserImportLease: vi.fn(),
  renewUserImportLease: vi.fn(),
  noteUserImportLeaseLost: vi.fn(),
  setUserImportStatus: vi.fn(),
  saveUserImportColumns: vi.fn(),
  deleteUserImportStaged: vi.fn(),
  stageUserImportRows: vi.fn(),
  classifyUserImport: vi.fn(),
  recheckUserImport: vi.fn(),
  applyUserImportBatch: vi.fn(),
  finishUserImportRows: vi.fn(),
  scheduleUserImportInvitations: vi.fn(),
  releaseNextUserImportInvitation: vi.fn(),
  undoUserImportBatch: vi.fn(),
  userImportUndoCounts: vi.fn(),
  clearUserImportSchedule: vi.fn(),
  jobFileStatus: vi.fn(),
  markUserImportPurged: vi.fn(),
  insertSystemAuditEvent: vi.fn(),
  loadUserImportHeaders: vi.fn(),
  loadUserImportReportRows: vi.fn(),
}));
const core = vi.hoisted(() => {
  class DomainError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    DomainError,
    isDomainError: (error: unknown, ...codes: string[]) =>
      error instanceof DomainError && (codes.length === 0 || codes.includes(error.code)),
    markFileUsed: vi.fn(),
    deleteFileRecord: vi.fn(),
  };
});
vi.mock('@jadarat/platform-db/jobs', () => db);
vi.mock('@jadarat/platform-db', () => core);

const ID = 'a5000000-0000-4000-8000-000000000001';
const claim = (step: UserImportClaim['step']): UserImportClaim => ({
  tenantId: 't1',
  importId: ID,
  step,
  leaseToken: 'lease',
});

/** The import as the database holds it; the mocks move it on. */
let state: UserImportJobView;
const base: UserImportJobView = {
  id: ID,
  status: 'uploaded',
  step: 'read',
  createdBy: 'u1',
  fileId: 'f1',
  fileName: 'staff.csv',
  fileStatus: 'clean',
  fileStatusReason: null,
  fileType: 'text/csv',
  sheets: [],
  sheetIndex: null,
  mapping: null,
  options: null,
  rowsTotal: 0,
  rowsDone: 0,
  stopRequested: false,
  reviewFileId: null,
  reportFileId: null,
  confirmedAt: null,
  failures: 0,
  importerLocale: 'ar',
  importerMayImport: true,
};

const STEP_OF: Record<string, UserImportJobView['step']> = {
  uploaded: 'read',
  validating: 'validate',
  queued: 'run',
  checking: 'run',
  importing: 'run',
  inviting: 'run',
  undoing: 'undo',
};

const csv = new TextEncoder().encode(
  CSV_BOM +
    csvLine(['Email', 'الاسم الأول', 'اسم العائلة', 'الجنسية']) +
    csvLine(['a@x.test', 'نورة', 'الدوسري', 'سعودية']) +
    csvLine(['b@x.test', 'فهد', 'العتيبي', 'سعودية']),
);
const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const files = { openScannedFile: vi.fn(), storeGeneratedFile: vi.fn() };
const logs: string[] = [];
const slept: number[] = [];
let clock = 0;
/** The transaction handle: equal to `{}` in the assertions; its savepoints run in it. */
const TX: object = Object.defineProperty({}, 'transaction', {
  value: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(TX)),
  enumerable: false,
});
const withPlatformTx = (_actor: unknown, fn: (tx: unknown) => unknown) => Promise.resolve(fn(TX));
const withSystemTx = (_actor: unknown, fn: (tx: unknown) => unknown) => Promise.resolve(fn(TX));
const task = () =>
  createUserImportTask({
    withPlatformTx: withPlatformTx as never,
    withSystemTx: withSystemTx as never,
    files,
    log: (level, message) => logs.push(`${level}: ${message}`),
    sending: { intervalMs: 2000, dailyCap: 10, trialDailyCap: 5 },
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  });

/** One claim, then nothing. */
function claimOnce(step: UserImportClaim['step']) {
  db.claimUserImportWork.mockResolvedValueOnce(claim(step)).mockResolvedValue(null);
}

beforeEach(() => {
  state = { ...base };
  clock = 0;
  logs.length = 0;
  slept.length = 0;
  db.loadUserImportForJob.mockImplementation(() => Promise.resolve({ ...state }));
  db.setUserImportStatus.mockImplementation(
    (
      _tx: unknown,
      _id: string,
      from: string[],
      to: string,
      change: Record<string, unknown> = {},
    ) => {
      if (!from.includes(state.status)) return Promise.resolve(false);
      state = {
        ...state,
        status: to as UserImportJobView['status'],
        step: STEP_OF[to] ?? null,
        ...(change.reportFileId !== undefined
          ? { reportFileId: change.reportFileId as string }
          : {}),
      };
      return Promise.resolve(true);
    },
  );
  db.releaseUserImportLease.mockResolvedValue(0);
  db.renewUserImportLease.mockResolvedValue(true);
  db.noteUserImportLeaseLost.mockResolvedValue(1);
  db.finishUserImportRows.mockResolvedValue({ added: 2, failed: 1, codes: { X: 1 }, text: '3' });
  db.loadUserImportHeaders.mockResolvedValue(new Map([[0, 'Email']]));
  db.loadUserImportReportRows.mockResolvedValue([
    {
      rowNumber: 3,
      cells: { email: 'b@x.test' },
      kind: 'error',
      result: 'failed',
      issues: [],
      resultIssues: [{ c: 'EMAIL_INVALID', s: 'e' }],
    },
  ]);
  db.jobFileStatus.mockResolvedValue('clean');
  files.openScannedFile.mockImplementation(() => Promise.resolve(streamOf(csv)));
  files.storeGeneratedFile.mockResolvedValue('report-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('user import task', () => {
  it('is the platform task `platform.user_imports`; nothing to claim: no more work', async () => {
    db.claimUserImportWork.mockResolvedValue(null);
    const t = task();
    expect(t.name).toBe(USER_IMPORT_TASK);
    await expect(t.run({ jobId: 'j' })).resolves.toBe(false);
  });

  it('read: the sheets and their columns (no samples of a column never imported) → mapping', async () => {
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('mapping');
    const [, , columns] = db.saveUserImportColumns.mock.calls[0] as [
      unknown,
      string,
      { header: string; samples: string[] }[],
    ];
    expect(columns.map((c) => [c.header, c.samples])).toEqual([
      ['Email', ['a@x.test', 'b@x.test']],
      ['الاسم الأول', ['نورة', 'فهد']],
      ['اسم العائلة', ['الدوسري', 'العتيبي']],
      ['الجنسية', []],
    ]);
    expect(db.releaseUserImportLease).toHaveBeenCalledWith({}, ID, 'lease', 'done');
    expect(logs.join('\n')).not.toContain('نورة');
  });

  it('read: refused when the scan did not pass, the type is not a spreadsheet, or the file is unreadable', async () => {
    state = { ...base, fileStatus: 'infected' };
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(db.setUserImportStatus).toHaveBeenCalledWith({}, ID, ['uploaded'], 'rejected', {
      failureCode: 'FILE_INFECTED',
    });

    state = { ...base, fileType: 'application/pdf' };
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(state).toMatchObject({ status: 'rejected' });

    state = { ...base };
    files.openScannedFile.mockResolvedValueOnce(streamOf(new Uint8Array([0xff, 0xfe, 0x00])));
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['uploaded'], 'rejected', {
      failureCode: 'FILE_ENCODING',
    });

    state = { ...base };
    files.openScannedFile.mockResolvedValueOnce(streamOf(new TextEncoder().encode('Email\n')));
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith(
      {},
      ID,
      ['uploaded'],
      'rejected',
      expect.objectContaining({ failureCode: 'FILE_EMPTY' }),
    );
  });

  it('validate: rows checked and staged, the dry run, the list of problems → review', async () => {
    state = {
      ...base,
      status: 'validating',
      step: 'validate',
      sheetIndex: 0,
      mapping: { '0': 'email', '1': 'first_name_ar', '2': 'family_name_ar', '9': 'nonsense' },
    };
    db.classifyUserImport.mockResolvedValue({ total: 2 });
    claimOnce('validate');
    await task().run({ jobId: 'j' });
    expect(db.deleteUserImportStaged).toHaveBeenCalledWith({}, ID, 'rows');
    const [, , staged] = db.stageUserImportRows.mock.calls[0] as [
      unknown,
      string,
      { rowNumber: number; data: Record<string, unknown> }[],
    ];
    expect(staged.map((r) => [r.rowNumber, r.data.email])).toEqual([
      [2, 'a@x.test'],
      [3, 'b@x.test'],
    ]);
    expect(files.storeGeneratedFile).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        purpose: 'platform.user_import_report',
        name: 'قائمة-المشكلات-staff.csv',
        forUserId: 'u1',
        type: 'text/csv',
      }),
    );
    expect(core.markFileUsed).not.toHaveBeenCalled();
    expect(state.status).toBe('review');
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['validating'], 'review', {
      rowsTotal: 2,
      reviewCounts: { total: 2 },
      reviewFileId: 'report-1',
    });
  });

  it('validate: a file that became unreadable is refused and its rows removed', async () => {
    state = {
      ...base,
      status: 'validating',
      step: 'validate',
      sheetIndex: 0,
      mapping: { '0': 'email' },
    };
    files.openScannedFile.mockResolvedValueOnce(streamOf(new TextEncoder().encode('a,"b\n')));
    claimOnce('validate');
    await task().run({ jobId: 'j' });
    expect(db.deleteUserImportStaged).toHaveBeenCalledTimes(2);
    expect(state.status).toBe('rejected');

    state = {
      ...base,
      status: 'validating',
      step: 'validate',
      sheetIndex: 0,
      mapping: { '0': 'email' },
      fileStatus: 'deleted',
    };
    claimOnce('validate');
    await task().run({ jobId: 'j' });
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['validating'], 'rejected', {
      failureCode: 'FILE_DELETED',
    });
  });

  it('run: queued → checking → importing in batches → inviting → finished, with the error report', async () => {
    state = {
      ...base,
      status: 'queued',
      step: 'run',
      sheetIndex: 0,
      mapping: { '0': 'email' },
      options: { existing: 'skip', defaultRole: 'learner', invitations: 'send' },
    };
    db.applyUserImportBatch
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(12)
      .mockResolvedValue(0);
    db.recheckUserImport.mockResolvedValue(1);
    db.scheduleUserImportInvitations.mockResolvedValue(512);
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('finished');
    expect(core.markFileUsed).toHaveBeenCalledWith({}, 'f1');
    expect(core.markFileUsed).toHaveBeenCalledWith({}, 'report-1');
    expect(db.applyUserImportBatch).toHaveBeenCalledTimes(3);
    expect(db.scheduleUserImportInvitations).toHaveBeenCalledWith({}, ID, 2);
    expect(db.clearUserImportSchedule).not.toHaveBeenCalled();
    expect(db.insertSystemAuditEvent).toHaveBeenCalledWith(
      {},
      {
        action: 'platform.user_import.finished',
        entityType: 'user_import',
        entityId: ID,
        data: { counts: { added: 2, failed: 1, text: 3 } },
      },
    );
    expect(state.reportFileId).toBe('report-1');
  });

  it('run: without invitations it finishes after the last batch; a stop ends it after the batch', async () => {
    state = {
      ...base,
      status: 'importing',
      step: 'run',
      options: { existing: 'skip', defaultRole: 'learner', invitations: 'hold' },
    };
    db.applyUserImportBatch.mockResolvedValue(0);
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('finished');
    // No sheet or mapping: no report.
    expect(files.storeGeneratedFile).not.toHaveBeenCalled();

    state = { ...base, status: 'inviting', step: 'run', stopRequested: true };
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('stopped');
    expect(db.clearUserImportSchedule).toHaveBeenCalledWith({}, ID);
  });

  it('run: the importer may no longer import → failed, no report for them (security review M1)', async () => {
    state = {
      ...base,
      status: 'importing',
      step: 'run',
      sheetIndex: 0,
      mapping: { '0': 'email' },
    };
    db.applyUserImportBatch.mockImplementation(() => {
      // Demoted or deactivated meanwhile: the next load sees it.
      state = { ...state, importerMayImport: false };
      return Promise.reject(new core.DomainError('IMPORTER_NOT_ALLOWED'));
    });
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('failed');
    expect(files.storeGeneratedFile).not.toHaveBeenCalled();
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['importing'], 'failed', {
      resultCounts: expect.any(Object),
      reportFileId: null,
      reportCode: 'IMPORTER_NOT_ALLOWED',
      failureCode: 'IMPORTER_NOT_ALLOWED',
    });
    expect(db.insertSystemAuditEvent).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        action: 'platform.user_import.failed',
        data: expect.objectContaining({
          failureCode: 'IMPORTER_NOT_ALLOWED',
          reportCode: 'IMPORTER_NOT_ALLOWED',
        }),
      }),
    );
  });

  it('run: the invitation guard refuses the schedule (importer gone, 42501 mapped) → failed', async () => {
    state = { ...base, status: 'inviting', step: 'run' };
    db.scheduleUserImportInvitations.mockRejectedValue(
      new core.DomainError('IMPORTER_NOT_ALLOWED'),
    );
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('failed');
    expect(db.clearUserImportSchedule).toHaveBeenCalledWith({}, ID);
  });

  it('run: an error report that cannot be stored is tried again with the step, then the run ends without it', async () => {
    const running = {
      ...base,
      status: 'importing' as const,
      step: 'run' as const,
      sheetIndex: 0,
      mapping: { '0': 'email' },
      options: { existing: 'skip' as const, defaultRole: 'learner', invitations: 'hold' as const },
    };
    db.applyUserImportBatch.mockResolvedValue(0);
    files.storeGeneratedFile.mockRejectedValue(
      Object.assign(new Error('storage'), { code: 'ECONNRESET' }),
    );
    state = { ...running, failures: 0 };
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('importing');
    expect(db.releaseUserImportLease).toHaveBeenLastCalledWith({}, ID, 'lease', 'retry');

    // The step's last attempt: the run ends, report_code says why.
    state = { ...running, failures: MAX_FAILURES - 1 };
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('finished');
    expect(db.setUserImportStatus).toHaveBeenCalledWith(
      {},
      ID,
      ['importing'],
      'finished',
      expect.objectContaining({ reportFileId: null, reportCode: 'REPORT_FAILED' }),
    );
    expect(logs.join('\n')).toContain('error report not stored (ECONNRESET)');
  });

  it('validate: an importer who may no longer import → failed (the review is theirs alone)', async () => {
    state = {
      ...base,
      status: 'validating',
      step: 'validate',
      sheetIndex: 0,
      mapping: { '0': 'email' },
      importerMayImport: false,
    };
    claimOnce('validate');
    await task().run({ jobId: 'j' });
    expect(files.openScannedFile).not.toHaveBeenCalled();
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['validating'], 'failed', {
      failureCode: 'IMPORTER_NOT_ALLOWED',
    });
  });

  it("send: one invitation per transaction at the send clock's pace, settings passed on", async () => {
    state = { ...base, status: 'finished', step: 'send' };
    db.releaseNextUserImportInvitation
      .mockResolvedValueOnce({ state: 'released', notBefore: null })
      .mockImplementationOnce(() =>
        Promise.resolve({ state: 'wait', notBefore: new Date(clock + 2000) }),
      )
      .mockResolvedValueOnce({ state: 'released', notBefore: null })
      .mockResolvedValueOnce({ state: 'none', notBefore: null });
    claimOnce('send');
    await task().run({ jobId: 'j' });
    expect(db.releaseNextUserImportInvitation).toHaveBeenCalledTimes(4);
    expect(db.releaseNextUserImportInvitation).toHaveBeenCalledWith({}, ID, {
      intervalMs: 2000,
      dailyCap: 10,
      trialDailyCap: 5,
    });
    expect(slept).toEqual([2000]);
    expect(logs.join('\n')).toContain('2 invitations sent');
    expect(db.releaseUserImportLease).toHaveBeenLastCalledWith({}, ID, 'lease', 'done');
  });

  it('send: imports take turns — at most SEND_SHARE per claim, then the next import', async () => {
    state = { ...base, status: 'finished', step: 'send' };
    db.releaseNextUserImportInvitation.mockResolvedValue({ state: 'released', notBefore: null });
    const other = { ...claim('send'), importId: 'a5000000-0000-4000-8000-000000000002' };
    db.claimUserImportWork
      .mockResolvedValueOnce(claim('send'))
      .mockResolvedValueOnce(other)
      .mockResolvedValue(null);
    await task().run({ jobId: 'j' });
    expect(db.releaseNextUserImportInvitation).toHaveBeenCalledTimes(2 * SEND_SHARE);
    expect(db.releaseUserImportLease.mock.calls.map((c) => c[1] as string)).toEqual([
      ID,
      other.importId,
    ]);
  });

  it('send: a long wait, a capped organization and an importer who may not invite end the turn', async () => {
    state = { ...base, status: 'finished', step: 'send' };
    db.releaseNextUserImportInvitation.mockImplementationOnce(() =>
      Promise.resolve({ state: 'wait', notBefore: new Date(clock + SEND_MAX_WAIT_MS + 1) }),
    );
    claimOnce('send');
    await task().run({ jobId: 'j' });
    expect(slept).toEqual([]);
    expect(db.releaseNextUserImportInvitation).toHaveBeenCalledTimes(1);

    db.releaseNextUserImportInvitation.mockResolvedValueOnce({
      state: 'capped',
      notBefore: new Date('2026-10-11T00:00:00Z'),
    });
    claimOnce('send');
    await task().run({ jobId: 'j' });
    expect(logs.join('\n')).toContain('daily number of invitations is reached');

    db.releaseNextUserImportInvitation.mockResolvedValueOnce({
      state: 'not_allowed',
      notBefore: null,
    });
    claimOnce('send');
    await task().run({ jobId: 'j' });
    expect(logs.join('\n')).toContain('may no longer invite');
    // Never more than the waits allowed per turn, even when the clock keeps saying "wait".
    db.releaseNextUserImportInvitation.mockImplementation(() =>
      Promise.resolve({ state: 'wait', notBefore: new Date(clock) }),
    );
    claimOnce('send');
    await task().run({ jobId: 'j' });
    expect(slept.length).toBe(2 * SEND_SHARE);
  });

  it('undo: batches, then undone with its numbers, audited', async () => {
    state = { ...base, status: 'undoing', step: 'undo' };
    db.undoUserImportBatch.mockResolvedValueOnce(500).mockResolvedValue(0);
    db.userImportUndoCounts.mockResolvedValue({ removed: 480, kept_accepted: 20 });
    claimOnce('undo');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('undone');
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['undoing'], 'undone', {
      undoCounts: { removed: 480, kept_accepted: 20 },
    });
    expect(db.insertSystemAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'platform.user_import.undone',
        data: { counts: { removed: 480, kept_accepted: 20 } },
      }),
    );
  });

  it('undo: the member who asked may no longer undo it (security review L1) → failed, what was undone stays', async () => {
    state = { ...base, status: 'undoing', step: 'undo' };
    db.undoUserImportBatch.mockResolvedValueOnce(500).mockResolvedValue(-1);
    db.userImportUndoCounts.mockResolvedValue({ removed: 500 });
    claimOnce('undo');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('failed');
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['undoing'], 'failed', {
      failureCode: 'UNDO_NOT_ALLOWED',
      undoCounts: { removed: 500 },
    });
    expect(db.insertSystemAuditEvent).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        action: 'platform.user_import.undo_failed',
        data: { counts: { removed: 500 }, failureCode: 'UNDO_NOT_ALLOWED' },
      }),
    );
  });

  it('expire and purge: the review ends; files (not infected ones) and data are deleted', async () => {
    state = { ...base, status: 'review', step: 'expire' };
    claimOnce('expire');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('expired');

    state = { ...base, status: 'finished', step: 'purge', reviewFileId: 'r1', reportFileId: 'p1' };
    db.jobFileStatus
      .mockResolvedValueOnce('clean')
      .mockResolvedValueOnce('infected')
      .mockResolvedValueOnce(null);
    claimOnce('purge');
    await task().run({ jobId: 'j' });
    expect(core.deleteFileRecord).toHaveBeenCalledTimes(1);
    expect(core.deleteFileRecord).toHaveBeenCalledWith({}, 'f1');
    expect(db.markUserImportPurged).toHaveBeenCalledWith({}, ID);
  });

  it('a step whose import changed meanwhile does nothing', async () => {
    for (const step of ['expire', 'read', 'validate', 'run', 'send', 'undo', 'purge'] as const) {
      state = { ...base, status: 'cancelled', step: null };
      claimOnce(step);
      await task().run({ jobId: 'j' });
    }
    expect(db.setUserImportStatus).not.toHaveBeenCalled();
    expect(db.markUserImportPurged).not.toHaveBeenCalled();
  });

  it('a lost lease: the pass leaves the import alone, but it counts as a failure (back-off)', async () => {
    db.loadUserImportForJob.mockResolvedValue(null);
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(logs.join('\n')).toContain('lease lost during read (failures: 1)');
    expect(db.noteUserImportLeaseLost).toHaveBeenCalledWith({}, ID, 'lease');
    expect(db.releaseUserImportLease).not.toHaveBeenCalled();
  });

  it('past MAX_FAILURES (failures or lost leases) the import ends instead of running the step again', async () => {
    state = { ...base, failures: MAX_FAILURES };
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(files.openScannedFile).not.toHaveBeenCalled();
    expect(db.setUserImportStatus).toHaveBeenCalledWith({}, ID, ['uploaded'], 'failed', {
      failureCode: 'SYSTEM_FAULT',
    });
  });

  it('reading renews the lease as rows go; a lost renewal stops it; past its time budget the file is refused', async () => {
    const big = new TextEncoder().encode(
      CSV_BOM +
        csvLine(['Email', 'الاسم الأول', 'اسم العائلة']) +
        Array.from({ length: 2500 }, (_v, i) => csvLine([`p${String(i)}@x.test`, 'س', 'ع'])).join(
          '',
        ),
    );
    files.openScannedFile.mockImplementation(() => Promise.resolve(streamOf(big)));
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('mapping');
    // Every transaction renews it, and the reading every 1000 rows.
    expect(db.renewUserImportLease.mock.calls.length).toBeGreaterThanOrEqual(4);

    state = { ...base };
    db.renewUserImportLease.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('uploaded');
    expect(db.noteUserImportLeaseLost).toHaveBeenCalled();

    state = { ...base };
    db.renewUserImportLease.mockImplementation(() => {
      clock += 6 * 60_000;
      return Promise.resolve(true);
    });
    claimOnce('read');
    await task().run({ jobId: 'j' });
    expect(db.setUserImportStatus).toHaveBeenLastCalledWith({}, ID, ['uploaded'], 'rejected', {
      failureCode: 'FILE_UNREADABLE',
    });
  });

  it('a failed step is tried again later; after MAX_FAILURES the import ends', async () => {
    state = { ...base, status: 'importing', step: 'run', failures: 0 };
    db.applyUserImportBatch.mockRejectedValue(
      Object.assign(new Error('boom: نورة'), { code: '40001' }),
    );
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(db.releaseUserImportLease).toHaveBeenCalledWith({}, ID, 'lease', 'retry');
    expect(logs.join('\n')).toContain('run failed (40001)');
    expect(logs.join('\n')).not.toContain('نورة');

    state = { ...base, status: 'importing', step: 'run', failures: MAX_FAILURES - 1 };
    db.applyUserImportBatch.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(0);
    claimOnce('run');
    await task().run({ jobId: 'j' });
    expect(state.status).toBe('failed');
    expect(db.releaseUserImportLease).toHaveBeenLastCalledWith({}, ID, 'lease', 'done');

    for (const [status, step] of [
      ['uploaded', 'read'],
      ['undoing', 'undo'],
    ] as const) {
      state = { ...base, status, step, failures: MAX_FAILURES };
      db.loadUserImportForJob.mockImplementationOnce(() => Promise.reject(new Error('down')));
      claimOnce(step);
      await task().run({ jobId: 'j' });
      expect(state.status).toBe('failed');
    }
  });

  it('hands over after its time budget', async () => {
    state = { ...base, status: 'importing', step: 'run' };
    db.applyUserImportBatch.mockImplementation(() => {
      clock += 5 * 60_000;
      return Promise.resolve(500);
    });
    db.claimUserImportWork.mockResolvedValue(claim('run'));
    await expect(task().run({ jobId: 'j' })).resolves.toBe(true);
    expect(db.releaseUserImportLease).toHaveBeenCalledWith({}, ID, 'lease', 'done');
  });

  it('names refusals and codes', () => {
    expect(fileRefusalCode('infected', null)).toBe('FILE_INFECTED');
    expect(fileRefusalCode('rejected', 'too_large')).toBe('FILE_TOO_LARGE');
    expect(fileRefusalCode('rejected', 'empty')).toBe('FILE_EMPTY');
    expect(fileRefusalCode('rejected', 'encrypted')).toBe('FILE_PROTECTED');
    expect(fileRefusalCode('rejected', 'unscannable')).toBe('FILE_UNREADABLE');
    expect(fileRefusalCode('rejected', 'type_mismatch')).toBe('FILE_TYPE');
    expect(fileRefusalCode('error', null)).toBe('FILE_SCAN_FAILED');
    expect(fileRefusalCode('clean', null)).toBe('FILE_TYPE');
    expect(fileRefusalCode(null, null)).toBe('FILE_DELETED');
    expect(codeOf(Object.assign(new Error('x'), { cause: { code: '23505' } }))).toBe('23505');
    expect(codeOf(new TypeError('x'))).toBe('TypeError');
    expect(codeOf('x')).toBe('unknown');
  });
});
