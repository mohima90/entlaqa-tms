import type { ActionContext } from '@jadarat/platform-rbac';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  cancelUserImport: vi.fn(),
  chooseUserImportMapping: vi.fn(),
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
  createDownloadGrant: vi.fn(),
  createUploadIntent: vi.fn(),
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
const actions = await import('./actions');

const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const fileContext = vi.fn(() => Promise.resolve({ ownTx: vi.fn(), storage: {} } as never));

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
}

async function run(definition: Runnable, input: unknown, ctx = context()) {
  return (await definition.handler({ ctx, input: definition.input.parse(input) } as never)) as {
    ok: boolean;
    value?: Record<string, unknown>;
    error?: { code: string; fieldErrors?: { path: string; code: string }[] };
  };
}

const fieldCode = (result: Awaited<ReturnType<typeof run>>) => result.error?.fieldErrors?.[0]?.code;

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
  it('reserves the upload for a new import and returns the signed URL', async () => {
    files.createUploadIntent.mockResolvedValue({
      fileId: 'f1',
      url: 'https://storage.test/u',
      method: 'PUT',
      contentType: 'text/csv',
      maxBytes: 20971520,
      expiresAt: new Date('2026-10-10T10:00:00Z'),
    });
    const result = await run(actions.startUserImportActionDefinition(fileContext), {
      fileName: 'موظفو الرياض.csv',
      size: 120,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      fileId: 'f1',
      upload: {
        url: 'https://storage.test/u',
        method: 'PUT',
        expiresAt: '2026-10-10T10:00:00.000Z',
      },
    });
    const [, intent] = files.createUploadIntent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(intent).toMatchObject({
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: result.value?.importId },
      size: 120,
    });
    expect(db.createUserImport).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ fileId: 'f1', fileSize: 120 }),
    );
  });

  it('refuses while another import runs, and the files service’s refusals', async () => {
    db.getRunningUserImport.mockResolvedValueOnce(record({ status: 'importing' }));
    const definition = actions.startUserImportActionDefinition(fileContext);
    expect(fieldCode(await run(definition, { fileName: 'a.csv', size: 1 }))).toBe(
      'ANOTHER_IMPORT_RUNNING',
    );
    files.createUploadIntent.mockRejectedValueOnce(new DomainError('TYPE_NOT_ALLOWED'));
    expect(fieldCode(await run(definition, { fileName: 'a.xls', size: 1 }))).toBe(
      'TYPE_NOT_ALLOWED',
    );
    files.createUploadIntent.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, { fileName: 'a.csv', size: 1 })).rejects.toThrow('boom');
    files.createUploadIntent.mockResolvedValueOnce({
      fileId: 'f1',
      url: 'u',
      method: 'PUT',
      contentType: 'text/csv',
      maxBytes: 1,
      expiresAt: new Date(),
    });
    db.createUserImport.mockRejectedValueOnce(new DomainError('NOT_ALLOWED'));
    expect((await run(definition, { fileName: 'a.csv', size: 1 })).error?.code).toBe('FORBIDDEN');
    expect(() =>
      definition.input.parse({ fileName: 'a.csv', size: 20 * 1024 * 1024 + 1 }),
    ).toThrow();
  });

  it('confirms the importer’s own upload (audited)', async () => {
    db.getUserImport.mockResolvedValue(record({ status: 'uploaded' }));
    files.confirmUpload.mockResolvedValue({ status: 'uploaded' });
    const definition = actions.confirmUserImportUploadActionDefinition();
    const result = await run(definition, { importId: ID });
    expect(result.value).toEqual({ importId: ID, fileId: 'f1', fileStatus: 'uploaded' });
    expect(definition.audit?.({ importId: ID }, result.value as never)).toEqual({
      action: 'platform.user_import.uploaded',
      entityType: 'user_import',
      entityId: ID,
      data: { fileId: 'f1' },
    });
    files.confirmUpload.mockRejectedValueOnce(new DomainError('OBJECT_NOT_UPLOADED'));
    expect(fieldCode(await run(definition, { importId: ID }))).toBe('OBJECT_NOT_UPLOADED');
    files.confirmUpload.mockRejectedValueOnce(new Error('boom'));
    await expect(run(definition, { importId: ID })).rejects.toThrow('boom');
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
    files.createDownloadGrant.mockResolvedValue({
      url: 'https://storage.test/d',
      name: 'r.csv',
      expiresAt: new Date(),
    });
    const definition = actions.downloadUserImportReportActionDefinition(fileContext);
    const result = await run(definition, { importId: ID, which: 'report' });
    expect(result.value).toEqual({
      importId: ID,
      which: 'report',
      url: 'https://storage.test/d',
      name: 'r.csv',
    });
    expect(files.createDownloadGrant).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'u1' },
      {
        fileId: 'p1',
        purpose: 'platform.user_import_report',
        owner: { module: 'platform', entityType: 'user_import', entityId: ID },
      },
    );
    expect(
      definition.audit?.({ importId: ID, which: 'report' }, result.value as never),
    ).toMatchObject({
      action: 'platform.user_import.report_downloaded',
      data: { which: 'report' },
    });
    await run(definition, { importId: ID, which: 'review' });
    expect(files.createDownloadGrant).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ fileId: 'r1' }),
    );
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
    files.createDownloadGrant.mockRejectedValueOnce(new DomainError('FILE_NOT_FOUND'));
    expect(fieldCode(await run(definition, { importId: ID, which: 'report' }))).toBe(
      'REPORT_DELETED',
    );
    files.createDownloadGrant.mockRejectedValueOnce(new DomainError('STORAGE_UNAVAILABLE'));
    expect(fieldCode(await run(definition, { importId: ID, which: 'report' }))).toBe(
      'STORAGE_UNAVAILABLE',
    );
    files.createDownloadGrant.mockRejectedValueOnce(new Error('boom'));
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
    db.scheduleHeldInvitations.mockRejectedValueOnce(new DomainError('NOT_ALLOWED'));
    expect((await run(definition, {})).error?.code).toBe('FORBIDDEN');
    expect(() => definition.input.parse({ importId: ID, invitationIds: [ID] })).toThrow();
  });
});

describe('queries', () => {
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
      actions.startUserImportActionDefinition(fileContext),
      actions.confirmUserImportUploadActionDefinition(),
      actions.chooseUserImportMappingActionDefinition(),
      actions.confirmUserImportActionDefinition(),
      actions.cancelUserImportActionDefinition(),
      actions.stopUserImportActionDefinition(),
      actions.undoUserImportActionDefinition(),
      actions.downloadUserImportReportActionDefinition(fileContext),
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
