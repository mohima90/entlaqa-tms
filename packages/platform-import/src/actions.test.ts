import type { ActionContext } from '@jadarat/platform-rbac';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  cancelUserImport: vi.fn(),
  chooseUserImportMapping: vi.fn(),
  closeUserImportUploadWindow: vi.fn(),
  confirmUserImport: vi.fn(),
  createUserImport: vi.fn(),
  getHeldInvitationsSummary: vi.fn(),
  getRunningUserImport: vi.fn(),
  getUndoPreview: vi.fn(),
  getUserImport: vi.fn(),
  listTemplateUnits: vi.fn(),
  listUserImportColumns: vi.fn(),
  listUserImportRows: vi.fn(),
  listUserImports: vi.fn(),
  requestUserImportUndo: vi.fn(),
  scheduleHeldInvitations: vi.fn(),
  stopUserImport: vi.fn(),
}));
const files = vi.hoisted(() => ({
  confirmUpload: vi.fn(),
  grantDownload: vi.fn(),
  reserveUploadIntent: vi.fn(),
  signDownload: vi.fn(),
  signUploadIntent: vi.fn(),
}));
vi.mock('@jadarat/platform-db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...db,
}));
vi.mock('@jadarat/platform-files', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...files,
}));

const { DomainError } = await import('@jadarat/platform-db');
const rbac = await import('@jadarat/platform-rbac');
const actions = await import('./actions');

const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
/** The user's Storage client for afterCommit (apps: requestFileStorage). */
const userStorage = { storage: 'user' };
const storage = vi.fn(() => Promise.resolve(userStorage as never));

function context(can: (code: string) => boolean = () => true): ActionContext<never> {
  return {
    claims: { sub: 'u1' } as never,
    actor: { userId: 'u1' } as never,
    grants: [{} as never],
    resource: null,
    can: (permission) => can(permission.code),
    access: (permission) => (can(permission.code) ? 'allowed' : 'denied'),
    grantsFor: () => [],
    tx: {} as never,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'review',
    fileId: 'f1',
    fileName: 'staff.csv',
    mine: true,
    mayUndo: true,
    sheets: [{ name: '', rows: 3, columns: 3 }],
    reviewCounts: { total: 3, new: 2, existing: 1, skipped: 0, errors: 0, warnings: 'x' },
    reviewFileId: 'r1',
    reportFileId: 'p1',
    dataPurgedAt: null,
    ...overrides,
  };
}

interface Runnable {
  handler: (args: never) => unknown;
  input: { parse: (v: unknown) => unknown };
  afterCommit?: (args: never) => unknown;
}

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: { code: string; fieldErrors?: { path: string; code: string }[] };
}

/** The handler alone (what runs in the action's transaction). */
async function run(definition: Runnable, input: unknown, ctx = context()) {
  return (await definition.handler({
    ctx,
    input: definition.input.parse(input),
  } as never)) as Outcome;
}

/**
 * As defineAction runs it: the handler (in the transaction), then — only after a committed success —
 * afterCommit with the handler's result (outside it).
 */
async function runCommitted(definition: Runnable, input: unknown, ctx = context()) {
  const parsed = definition.input.parse(input);
  const handled = (await definition.handler({ ctx, input: parsed } as never)) as Outcome;
  if (!handled.ok || !definition.afterCommit) return { handled, answer: handled };
  const answer = (await definition.afterCommit({
    actor: ctx.actor,
    input: parsed,
    result: handled.value,
  } as never)) as Outcome;
  return { handled, answer };
}

const fieldCode = (result: Outcome) => result.error?.fieldErrors?.[0]?.code;

beforeEach(() => {
  db.getRunningUserImport.mockResolvedValue(null);
  db.getUserImport.mockResolvedValue(record());
  db.listUserImportColumns.mockResolvedValue([
    { sheetIndex: 0, index: 0, header: 'Email', samples: ['a@x.test', 'b@x.test'] },
    { sheetIndex: 0, index: 1, header: 'الاسم الأول', samples: ['نورة'] },
    { sheetIndex: 0, index: 2, header: 'اسم العائلة', samples: ['الدوسري'] },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('start and upload (step 1)', () => {
  const reservation = {
    fileId: 'f1',
    bucket: 'imports',
    objectKey: 't/platform/user_import/i/f1',
    contentType: 'text/csv',
    maxBytes: 20971520,
    expiresAt: new Date('2026-10-10T10:00:00Z'),
  };
  const intent = {
    fileId: 'f1',
    url: 'https://storage.test/u',
    method: 'PUT',
    contentType: 'text/csv',
    maxBytes: 20971520,
    expiresAt: new Date('2026-10-10T10:00:00Z'),
  };

  it('reserves the upload and creates the import in the transaction, then signs after the commit', async () => {
    files.reserveUploadIntent.mockResolvedValue(reservation);
    files.signUploadIntent.mockResolvedValue(intent);
    const definition = actions.startUserImportActionDefinition(storage);
    // T-M2-18 × T-M2-12: no Storage call inside the transaction, so the action may be retried after a
    // conflict — no externalEffects.
    expect(definition.externalEffects).toBeUndefined();
    const { handled, answer } = await runCommitted(definition, {
      fileName: 'موظفو الرياض.csv',
      size: 120,
    });
    // The transaction's part: the reservation and the import — nothing signed yet.
    expect(handled.value).toEqual({ importId: expect.any(String), reservation });
    const importId = handled.value?.importId;
    const [tx, input] = files.reserveUploadIntent.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(tx).toEqual({});
    expect(input).toMatchObject({
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: importId },
      declaredName: 'موظفو الرياض.csv',
      size: 120,
    });
    expect(db.createUserImport).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: importId, fileId: 'f1', fileSize: 120 }),
    );
    // After the commit: the user's Storage signs exactly the reservation.
    expect(storage).toHaveBeenCalledTimes(1);
    expect(files.signUploadIntent).toHaveBeenCalledWith(userStorage, reservation);
    expect(answer).toEqual({
      ok: true,
      value: {
        importId,
        fileId: 'f1',
        upload: {
          url: 'https://storage.test/u',
          method: 'PUT',
          contentType: 'text/csv',
          maxBytes: 20971520,
          expiresAt: '2026-10-10T10:00:00.000Z',
        },
      },
    });
  });

  it('refuses while another import runs, and the files service’s refusals', async () => {
    db.getRunningUserImport.mockResolvedValueOnce(record({ status: 'importing' }));
    const definition = actions.startUserImportActionDefinition(storage);
    expect(fieldCode(await run(definition, { fileName: 'a.csv', size: 1 }))).toBe(
      'ANOTHER_IMPORT_RUNNING',
    );
    expect(files.reserveUploadIntent).not.toHaveBeenCalled();
    // Expected refusals are error results with the files service's codes (fileResult); nothing is
    // created and nothing signed.
    for (const [code, answer] of [
      ['TYPE_NOT_ALLOWED', 'FILE_TYPE_NOT_ALLOWED'],
      ['TOO_LARGE', 'FILE_TOO_LARGE'],
      ['TOO_MANY_PENDING_UPLOADS', 'FILE_TOO_MANY_UPLOADS'],
    ] as const) {
      files.reserveUploadIntent.mockRejectedValueOnce(new DomainError(code));
      const { answer: result } = await runCommitted(definition, { fileName: 'a.xls', size: 1 });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(answer);
    }
    expect(db.createUserImport).not.toHaveBeenCalled();
    expect(files.signUploadIntent).not.toHaveBeenCalled();
    // A module bug or an outage stays an internal error.
    files.reserveUploadIntent.mockRejectedValueOnce(new DomainError('INVALID_FILE_DATA'));
    await expect(run(definition, { fileName: 'a.csv', size: 1 })).rejects.toMatchObject({
      code: 'INVALID_FILE_DATA',
    });
    files.reserveUploadIntent.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, { fileName: 'a.csv', size: 1 })).rejects.toThrow('boom');
    files.reserveUploadIntent.mockResolvedValueOnce(reservation);
    db.createUserImport.mockRejectedValueOnce(new DomainError('NOT_ALLOWED'));
    expect((await run(definition, { fileName: 'a.csv', size: 1 })).error?.code).toBe('FORBIDDEN');
    files.reserveUploadIntent.mockResolvedValueOnce(reservation);
    db.createUserImport.mockRejectedValueOnce(new DomainError('TOO_MANY_DRAFTS'));
    expect(fieldCode(await run(definition, { fileName: 'a.csv', size: 1 }))).toBe(
      'TOO_MANY_DRAFTS',
    );
    expect(() =>
      definition.input.parse({ fileName: 'a.csv', size: 20 * 1024 * 1024 + 1 }),
    ).toThrow();
  });

  it('answers a Storage refusal after the commit as an error result (the import waits for a file)', async () => {
    const definition = actions.startUserImportActionDefinition(storage);
    files.reserveUploadIntent.mockResolvedValue(reservation);
    files.signUploadIntent.mockRejectedValueOnce(new DomainError('STORAGE_UNAVAILABLE'));
    const unavailable = await runCommitted(definition, { fileName: 'a.csv', size: 1 });
    expect(unavailable.handled.ok).toBe(true);
    expect(unavailable.answer.error?.code).toBe('FILE_STORAGE_UNAVAILABLE');
    files.signUploadIntent.mockRejectedValueOnce(new DomainError('STORAGE_REFUSED'));
    expect(
      (await runCommitted(definition, { fileName: 'a.csv', size: 1 })).answer.error?.code,
    ).toBe('FORBIDDEN');
    // Signing inside a transaction (or any other failure) is a bug: thrown, an internal error.
    files.signUploadIntent.mockRejectedValueOnce(new Error('inside a transaction'));
    await expect(runCommitted(definition, { fileName: 'a.csv', size: 1 })).rejects.toThrow(
      'inside a transaction',
    );
  });

  it('confirms the importer’s own upload (audited)', async () => {
    db.getUserImport.mockResolvedValue(record({ status: 'uploaded' }));
    files.confirmUpload.mockResolvedValue({ status: 'uploaded' });
    const definition = actions.confirmUserImportUploadActionDefinition();
    const result = await run(definition, { importId: ID });
    expect(result.value).toEqual({ importId: ID, fileId: 'f1', fileStatus: 'uploaded' });
    // Integration review M1: the confirmed import is no longer subject to its upload window.
    expect(db.closeUserImportUploadWindow).toHaveBeenCalledWith({}, ID);
    expect(definition.audit?.({ importId: ID }, result.value as never)).toEqual({
      action: 'platform.user_import.uploaded',
      entityType: 'user_import',
      entityId: ID,
      data: { fileId: 'f1' },
    });
    expect(definition.afterCommit).toBeUndefined();
    files.confirmUpload.mockRejectedValueOnce(new DomainError('OBJECT_NOT_UPLOADED'));
    expect((await run(definition, { importId: ID })).error?.code).toBe('FILE_NOT_UPLOADED');
    files.confirmUpload.mockRejectedValueOnce(new DomainError('UPLOAD_EXPIRED'));
    expect((await run(definition, { importId: ID })).error?.code).toBe('FILE_UPLOAD_EXPIRED');
    files.confirmUpload.mockRejectedValueOnce(new DomainError('FILE_NOT_FOUND'));
    expect((await run(definition, { importId: ID })).error?.code).toBe('NOT_FOUND');
    files.confirmUpload.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, { importId: ID })).rejects.toThrow('boom');
    // The worker expired it meanwhile (its window passed): the screens say the status changed.
    db.closeUserImportUploadWindow.mockClear();
    files.confirmUpload.mockResolvedValueOnce({ status: 'uploaded' });
    db.closeUserImportUploadWindow.mockRejectedValueOnce(new DomainError('IMPORT_STATE_CHANGED'));
    expect(fieldCode(await run(definition, { importId: ID }))).toBe('IMPORT_STATE_CHANGED');
    // A file not confirmed leaves the window open.
    db.closeUserImportUploadWindow.mockClear();
    files.confirmUpload.mockRejectedValueOnce(new DomainError('OBJECT_NOT_UPLOADED'));
    await run(definition, { importId: ID });
    expect(db.closeUserImportUploadWindow).not.toHaveBeenCalled();
    db.getUserImport.mockResolvedValueOnce(record({ status: 'mapping' }));
    expect(fieldCode(await run(definition, { importId: ID }))).toBe('IMPORT_STATE_CHANGED');
    db.getUserImport.mockResolvedValueOnce(record({ mine: false }));
    expect((await run(definition, { importId: ID })).error?.code).toBe('FORBIDDEN');
    db.getUserImport.mockResolvedValueOnce(null);
    expect((await run(definition, { importId: ID })).error?.code).toBe('NOT_FOUND');
  });
});

describe('mapping (step 2)', () => {
  const definition = actions.chooseUserImportMappingActionDefinition();
  const mapping = { '0': 'email', '1': 'first_name_ar', '2': 'family_name_ar' };

  it('checks the sheet and the mapping against the file’s columns, then starts the dry run', async () => {
    const result = await run(definition, { importId: ID, sheetIndex: 0, mapping });
    expect(result).toEqual({ ok: true, value: { importId: ID } });
    expect(db.chooseUserImportMapping).toHaveBeenCalledWith({}, ID, { sheetIndex: 0, mapping });
    expect(
      definition.audit?.({ importId: ID, sheetIndex: 0, mapping } as never, { importId: ID }),
    ).toMatchObject({
      action: 'platform.user_import.mapped',
      data: { sheetIndex: 0, fields: ['email', 'family_name_ar', 'first_name_ar'] },
    });
  });

  it('refuses another step, a sheet that cannot be imported and an incomplete mapping', async () => {
    db.getUserImport.mockResolvedValueOnce(record({ status: 'importing' }));
    expect(fieldCode(await run(definition, { importId: ID, sheetIndex: 0, mapping }))).toBe(
      'IMPORT_STATE_CHANGED',
    );
    expect(fieldCode(await run(definition, { importId: ID, sheetIndex: 3, mapping }))).toBe(
      'NO_SUCH_SHEET',
    );
    db.getUserImport.mockResolvedValueOnce(record({ sheets: [{ name: '', rows: 0, columns: 1 }] }));
    expect(fieldCode(await run(definition, { importId: ID, sheetIndex: 0, mapping }))).toBe(
      'SHEET_EMPTY',
    );
    db.getUserImport.mockResolvedValueOnce(
      record({ sheets: [{ name: '', rows: 10_001, columns: 1 }] }),
    );
    expect(fieldCode(await run(definition, { importId: ID, sheetIndex: 0, mapping }))).toBe(
      'SHEET_TOO_MANY_ROWS',
    );
    const incomplete = await run(definition, {
      importId: ID,
      sheetIndex: 0,
      mapping: { '0': 'email', '7': 'mobile' },
    });
    expect(incomplete.error?.fieldErrors).toEqual([
      { path: 'mapping.7', code: 'NO_COLUMN' },
      { path: 'mapping.first_name_ar', code: 'MISSING' },
      { path: 'mapping.family_name_ar', code: 'MISSING' },
    ]);
    db.chooseUserImportMapping.mockRejectedValueOnce(new DomainError('REVIEW_EXPIRED'));
    expect(fieldCode(await run(definition, { importId: ID, sheetIndex: 0, mapping }))).toBe(
      'REVIEW_EXPIRED',
    );
    expect(() =>
      definition.input.parse({ importId: ID, sheetIndex: 0, mapping: { '0': 'status' } }),
    ).toThrow();
  });
});

describe('confirm, cancel, stop, undo', () => {
  it('confirms with options; updating existing people needs platform.user.update', async () => {
    const definition = actions.confirmUserImportActionDefinition();
    const input = { importId: ID, existing: 'upsert', defaultRole: 'learner', invitations: 'send' };
    const denied = await run(
      definition,
      input,
      context((code) => code !== 'platform.user.update'),
    );
    expect(denied.error?.code).toBe('FORBIDDEN');
    const result = await run(definition, input);
    expect(result.ok).toBe(true);
    expect(db.confirmUserImport).toHaveBeenCalledWith({}, ID, {
      existing: 'upsert',
      defaultRole: 'learner',
      invitations: 'send',
    });
    expect(definition.audit?.(definition.input.parse(input), result.value as never)).toEqual({
      action: 'platform.user_import.confirmed',
      entityType: 'user_import',
      entityId: ID,
      data: {
        options: { existing: 'upsert', defaultRole: 'learner', invitations: 'send' },
        counts: { total: 3, new: 2, existing: 1, skipped: 0, errors: 0, warnings: 0 },
      },
    });
    db.confirmUserImport.mockRejectedValueOnce(new DomainError('ANOTHER_IMPORT_RUNNING'));
    expect(fieldCode(await run(definition, input))).toBe('ANOTHER_IMPORT_RUNNING');
    db.confirmUserImport.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, input)).rejects.toThrow('boom');
    // Never a privileged default role.
    expect(() => definition.input.parse({ ...input, defaultRole: 'hr_manager' })).toThrow();
    expect(() => definition.input.parse({ ...input, defaultRole: 'tenant_admin' })).toThrow();
  });

  // Step-up (TM-0003 D-IAM-01, PO 6 Oct 2026; integration T-M2-10 × T-M2-12): the single-user flows ask
  // for a fresh authenticator code (platform.role.assign_privileged: high risk, AAL2) only to give or take
  // a privileged role. An import never gives one — so starting it is the ordinary invite, without step-up.
  it('an import gives only roles the ordinary single invite gives; privileged ones are refused', () => {
    const confirm = actions.confirmUserImportActionDefinition();
    const ordinaryInvite = rbac.inviteUserActionDefinition();
    expect(confirm.permission).toBe(ordinaryInvite.permission);
    expect(confirm.permission.risk).not.toBe('high');
    expect(confirm.permission.requiresAal2).toBe(false);
    expect(rbac.requiresStrictVerification(confirm.permission)).toBe(false);
    // The privileged path of the single-user flows (Organization Admin, high risk: strict session check;
    // no authenticator code since the PO decision of 14 Oct 2026) is one an import never takes.
    const privilegedInvite = rbac.invitePrivilegedUserActionDefinition();
    expect(privilegedInvite.permission.code).toBe('platform.role.assign_privileged');
    expect(rbac.requiresStrictVerification(privilegedInvite.permission)).toBe(true);
    // Every default role the confirmation accepts goes through the ordinary path…
    const accepted = confirm.input.shape.defaultRole.options;
    expect(accepted.length).toBeGreaterThan(0);
    for (const role of accepted) {
      expect(rbac.invitationGivesPrivilegedRole({ primaryRole: role, additionalRoles: [] })).toBe(
        false,
      );
    }
    // …and every role the single-user flows treat as privileged is refused as the default role.
    expect(rbac.PRIVILEGED_ROLE_CODES.length).toBeGreaterThan(0);
    for (const role of rbac.PRIVILEGED_ROLE_CODES) {
      expect(accepted).not.toContain(role);
      expect(() =>
        confirm.input.parse({
          importId: ID,
          existing: 'skip',
          defaultRole: role,
          invitations: 'send',
        }),
      ).toThrow();
    }
  });

  it('cancels, stops and undoes (audited); refusals as the screens show them', async () => {
    const cancel = actions.cancelUserImportActionDefinition();
    expect((await run(cancel, { importId: ID })).ok).toBe(true);
    expect(cancel.audit?.({ importId: ID }, { importId: ID })?.action).toBe(
      'platform.user_import.cancelled',
    );
    db.cancelUserImport.mockRejectedValueOnce(new DomainError('NOT_IMPORTER'));
    expect((await run(cancel, { importId: ID })).error?.code).toBe('FORBIDDEN');

    const stop = actions.stopUserImportActionDefinition();
    expect((await run(stop, { importId: ID })).ok).toBe(true);
    expect(stop.audit?.({ importId: ID }, { importId: ID })?.action).toBe(
      'platform.user_import.stop_requested',
    );
    db.stopUserImport.mockRejectedValueOnce(new DomainError('IMPORT_NOT_FOUND'));
    expect((await run(stop, { importId: ID })).error?.code).toBe('NOT_FOUND');

    const undo = actions.undoUserImportActionDefinition();
    const done = await run(undo, { importId: ID, reason: 'wrong_file' });
    expect(done.value).toEqual({ importId: ID, reason: 'wrong_file' });
    expect(
      undo.audit?.({ importId: ID, reason: 'wrong_file' }, { importId: ID, reason: 'wrong_file' }),
    ).toEqual({
      action: 'platform.user_import.undo_requested',
      entityType: 'user_import',
      entityId: ID,
      data: { reason: 'wrong_file' },
    });
    db.requestUserImportUndo.mockRejectedValueOnce(new DomainError('UNDO_EXPIRED'));
    expect(fieldCode(await run(undo, { importId: ID, reason: null }))).toBe('UNDO_EXPIRED');
    db.requestUserImportUndo.mockRejectedValueOnce(new DomainError('SOMETHING_ELSE'));
    await expect(run(undo, { importId: ID, reason: null })).rejects.toMatchObject({
      code: 'SOMETHING_ELSE',
    });
  });
});

describe('reports and held invitations', () => {
  it('the importer alone downloads the report or the review list (audited)', async () => {
    const granted = {
      bucket: 'generated',
      objectKey: 't/platform/user_import/i/p1',
      name: 'r.xlsx',
      ttlSeconds: 60,
    };
    files.grantDownload.mockResolvedValue(granted);
    files.signDownload.mockResolvedValue({
      url: 'https://storage.test/d',
      name: 'r.xlsx',
      expiresAt: new Date(),
    });
    const definition = actions.downloadUserImportReportActionDefinition(storage);
    expect(definition.externalEffects).toBeUndefined();
    const { handled, answer } = await runCommitted(definition, { importId: ID, which: 'report' });
    // In the transaction: the grant (for exactly this import's report) and the audit record.
    expect(handled.value).toEqual({ importId: ID, which: 'report', granted });
    expect(files.grantDownload).toHaveBeenCalledWith(
      {},
      { userId: 'u1' },
      {
        fileId: 'p1',
        purpose: 'platform.user_import_report',
        owner: { module: 'platform', entityType: 'user_import', entityId: ID },
      },
    );
    expect(
      definition.audit?.({ importId: ID, which: 'report' }, handled.value as never),
    ).toMatchObject({
      action: 'platform.user_import.report_downloaded',
      data: { which: 'report' },
    });
    // After the commit: the user's Storage signs the grant.
    expect(files.signDownload).toHaveBeenCalledWith(userStorage, granted);
    expect(answer).toEqual({
      ok: true,
      value: { importId: ID, which: 'report', url: 'https://storage.test/d', name: 'r.xlsx' },
    });
    await run(definition, { importId: ID, which: 'review' });
    expect(files.grantDownload).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ fileId: 'r1' }),
    );
    // Storage refusing after the commit: an answer, not an internal error (the grant expires unused).
    files.signDownload.mockRejectedValueOnce(new DomainError('STORAGE_UNAVAILABLE'));
    expect(
      (await runCommitted(definition, { importId: ID, which: 'report' })).answer.error?.code,
    ).toBe('FILE_STORAGE_UNAVAILABLE');
    files.signDownload.mockRejectedValueOnce(new DomainError('STORAGE_REFUSED'));
    expect(
      (await runCommitted(definition, { importId: ID, which: 'report' })).answer.error?.code,
    ).toBe('FORBIDDEN');
    db.getUserImport.mockResolvedValueOnce(record({ mine: false }));
    expect(fieldCode(await run(definition, { importId: ID, which: 'report' }))).toBe(
      'REPORT_NOT_YOURS',
    );
    db.getUserImport.mockResolvedValueOnce(null);
    expect((await run(definition, { importId: ID, which: 'report' })).error?.code).toBe(
      'NOT_FOUND',
    );
    db.getUserImport.mockResolvedValueOnce(record({ reportFileId: null }));
    expect(fieldCode(await run(definition, { importId: ID, which: 'report' }))).toBe(
      'REPORT_DELETED',
    );
    // Purged, or never clean: the report is gone (as the screens say it).
    for (const code of ['FILE_NOT_FOUND', 'FILE_NOT_CLEAN']) {
      files.grantDownload.mockRejectedValueOnce(new DomainError(code));
      expect(fieldCode(await run(definition, { importId: ID, which: 'report' }))).toBe(
        'REPORT_DELETED',
      );
    }
    files.grantDownload.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, { importId: ID, which: 'report' })).rejects.toThrow('boom');
  });

  it('sends held invitations by id or by import (audited), or says there is nothing to send', async () => {
    const definition = actions.sendHeldInvitationsActionDefinition();
    db.scheduleHeldInvitations.mockResolvedValueOnce(3);
    const byImport = await run(definition, { importId: ID });
    expect(byImport.value).toEqual({ scheduled: 3, importId: ID });
    expect(db.scheduleHeldInvitations).toHaveBeenCalledWith({}, { importId: ID }, 1);
    expect(definition.audit?.({ importId: ID }, byImport.value as never)).toEqual({
      action: 'platform.invitation.send_requested',
      entityType: 'user_import',
      entityId: ID,
      data: { count: 3 },
    });
    db.scheduleHeldInvitations.mockResolvedValueOnce(1);
    const byId = await run(definition, { invitationIds: [ID] });
    expect(definition.audit?.({ invitationIds: [ID] }, byId.value as never)).toEqual({
      action: 'platform.invitation.send_requested',
      entityType: 'invitation',
      data: { count: 1 },
    });
    db.scheduleHeldInvitations.mockResolvedValueOnce(0);
    expect(fieldCode(await run(definition, {}))).toBe('NOTHING_TO_SEND');
    // Sent for the member who asks (integration review M2): refused up front, with its own code, when
    // they may not invite.
    db.scheduleHeldInvitations.mockRejectedValueOnce(new DomainError('NOT_ALLOWED'));
    expect(fieldCode(await run(definition, {}))).toBe('SEND_NOT_ALLOWED');
    db.scheduleHeldInvitations.mockRejectedValueOnce(new DomainError('IMPORT_NOT_FOUND'));
    expect((await run(definition, {})).error?.code).toBe('NOT_FOUND');
    expect(() => definition.input.parse({ importId: ID, invitationIds: [ID] })).toThrow();
  });
});

describe('queries', () => {
  it('the page’s status poll: a passive read of the version only (integration review L1)', async () => {
    const definition = actions.userImportStatusQueryDefinition();
    expect(definition.passiveRead).toBe('platform.user_import.status');
    expect(definition).not.toHaveProperty('audit');
    expect(definition).not.toHaveProperty('afterCommit');
    const running = record({ status: 'importing', rowsDone: 500, rowsTotal: 3 });
    db.getUserImport.mockResolvedValueOnce(running);
    const result = await run(definition, { importId: ID });
    expect(result.value).toEqual({ version: actions.userImportVersion(running as never) });
    expect(String(result.value?.version)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    db.getUserImport.mockResolvedValueOnce(null);
    expect((await run(definition, { importId: ID })).error?.code).toBe('NOT_FOUND');
  });

  it('the version moves with what the page shows, not with the worker’s bookkeeping', () => {
    const v = (over: Record<string, unknown>) =>
      actions.userImportVersion(record({ status: 'importing', rowsDone: 500, ...over }) as never);
    const base = v({});
    expect(v({ updatedAt: new Date(), nextAttemptAt: new Date() })).toBe(base);
    expect(v({ rowsDone: 1000 })).not.toBe(base);
    expect(v({ status: 'inviting' })).not.toBe(base);
    expect(v({ stopRequestedAt: new Date('2026-10-11T08:00:00Z') })).not.toBe(base);
    expect(v({ fileStatus: 'clean' })).not.toBe(v({ fileStatus: 'scanning' }));
    expect(v({ resultCounts: { added: 1 } })).not.toBe(base);
  });

  it('step 1: the running and recent imports', async () => {
    db.listUserImports.mockResolvedValue([record()]);
    const result = await run(actions.userImportStartQueryDefinition(), {});
    expect(result.value).toEqual({ running: null, recent: [record()] });
  });

  it('an import: the importer’s columns with their recognition, options and undo preview', async () => {
    db.getUserImport.mockResolvedValue(
      record({ status: 'finished', sheets: [{ name: '', rows: 3, columns: 3 }] }),
    );
    db.getUndoPreview.mockResolvedValue({ added: 2, accepted: 0, updated: 1 });
    const result = await run(actions.userImportQueryDefinition(), { importId: ID });
    expect(result.value).toMatchObject({
      canUpdate: true,
      required: ['email', 'first_name_ar', 'family_name_ar'],
      maxRows: 10_000,
      undo: { added: 2, accepted: 0, updated: 1 },
      privilegedAccess: 'allowed',
    });
    const view = result.value as { columns: { recognition: unknown }[]; roles: string[] };
    expect(view.columns.map((c) => c.recognition)).toEqual([
      { kind: 'recognized', field: 'email' },
      { kind: 'recognized', field: 'first_name_ar' },
      { kind: 'recognized', field: 'family_name_ar' },
    ]);
    expect(view.roles).not.toContain('hr_manager');

    // An Organization Admin viewing someone else's import: no columns, but the undo preview (counts).
    db.getUserImport.mockResolvedValueOnce(record({ status: 'finished', mine: false }));
    const admin = await run(actions.userImportQueryDefinition(), { importId: ID });
    expect(admin.value).toMatchObject({ columns: [], undo: { added: 2, accepted: 0, updated: 1 } });
    // Anyone else: neither.
    db.getUserImport.mockResolvedValueOnce(
      record({ status: 'finished', mine: false, mayUndo: false }),
    );
    const other = await run(actions.userImportQueryDefinition(), { importId: ID });
    expect(other.value).toMatchObject({ columns: [], undo: null });
    db.getUserImport.mockResolvedValueOnce(null);
    expect((await run(actions.userImportQueryDefinition(), { importId: ID })).error?.code).toBe(
      'NOT_FOUND',
    );
  });

  it('a page of the review rows, for the importer only', async () => {
    db.listUserImportRows.mockResolvedValue({ total: 30, rows: [] });
    const definition = actions.userImportRowsQueryDefinition();
    const result = await run(definition, {
      importId: ID,
      view: 'warnings',
      code: 'DEPARTMENT_NOT_FOUND',
      page: '2',
    });
    expect(result.value).toEqual({ total: 30, page: 2, pageSize: 25, rows: [] });
    expect(db.listUserImportRows).toHaveBeenCalledWith({}, ID, {
      view: 'warnings',
      code: 'DEPARTMENT_NOT_FOUND',
      offset: 25,
      limit: 25,
    });
    db.getUserImport.mockResolvedValueOnce(record({ mine: false }));
    expect((await run(definition, { importId: ID })).error?.code).toBe('FORBIDDEN');
    expect(() => definition.input.parse({ importId: ID, code: 'drop table' })).toThrow();
  });

  it('banners and the template’s lists', async () => {
    db.getHeldInvitationsSummary.mockResolvedValue({ total: 0, latest: null });
    expect((await run(actions.userImportBannersQueryDefinition(), {})).value).toEqual({
      running: null,
      held: { total: 0, latest: null },
    });
    db.listTemplateUnits.mockResolvedValue({
      departments: [{ code: 'A', nameAr: 'أ', nameEn: null }],
      branches: [],
    });
    const template = actions.userImportTemplateQueryDefinition();
    expect((await run(template, {})).value).toEqual({
      departments: [{ code: 'A', nameAr: 'أ', nameEn: null }],
      branches: [],
    });
    expect(
      (
        await run(
          template,
          {},
          context((code) => code !== 'platform.org.read'),
        )
      ).value,
    ).toEqual({
      departments: [],
      branches: [],
    });
  });

  it('every definition needs platform.user.invite (Organization Admin, HR Manager)', () => {
    for (const definition of [
      actions.startUserImportActionDefinition(storage),
      actions.confirmUserImportUploadActionDefinition(),
      actions.chooseUserImportMappingActionDefinition(),
      actions.confirmUserImportActionDefinition(),
      actions.cancelUserImportActionDefinition(),
      actions.stopUserImportActionDefinition(),
      actions.undoUserImportActionDefinition(),
      actions.downloadUserImportReportActionDefinition(storage),
      actions.sendHeldInvitationsActionDefinition(),
      actions.userImportStartQueryDefinition(),
      actions.userImportQueryDefinition(),
      actions.userImportRowsQueryDefinition(),
      actions.userImportBannersQueryDefinition(),
      actions.userImportTemplateQueryDefinition(),
    ]) {
      expect(definition.permission.code).toBe('platform.user.invite');
    }
  });
});
