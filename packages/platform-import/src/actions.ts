import { createHash, randomUUID } from 'node:crypto';
import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type HeldInvitationsSummary,
  type ImportRowView,
  type UndoPreview,
  type UserImportColumn,
  type UserImportRecord,
  type UserTx,
  cancelUserImport,
  chooseUserImportMapping,
  closeUserImportUploadWindow,
  confirmUserImport,
  createUserImport,
  getHeldInvitationsSummary,
  getRunningUserImport,
  getTenantDefaultLocale,
  getUndoPreview,
  getUserImport,
  isDomainError,
  listTemplateUnits,
  listUserImportColumns,
  listUserImportRows,
  listUserImports,
  requestUserImportUndo,
  scheduleHeldInvitations,
  stopUserImport,
} from '@jadarat/platform-db';
import {
  type GrantedDownload,
  type UploadReservation,
  confirmUpload,
  fileResult,
  grantDownload,
  reserveUploadIntent,
  sanitizeFileName,
  signDownload,
  signUploadIntent,
} from '@jadarat/platform-files';
import {
  type ActionDefinition,
  type PermissionAccess,
  type QueryDefinition,
  platformPermissions,
} from '@jadarat/platform-rbac';
import { z } from 'zod';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS } from './users/limits';
import { IMPORT_FIELDS, type NameLanguage, requiredFields } from './users/fields';
import { type ColumnRecognition, mappingProblems, recognizeColumns } from './users/headers';
import { IMPORTABLE_ROLES } from './users/roles';
import type { TemplateLists } from './users/template';

/**
 * The bulk user import's actions and queries (T-M2-12, FR-IAM-04; approved screens 1–13). Who: holders
 * of `platform.user.invite` — Organization Admin and HR Manager, the people who invite one person (PO
 * decision 2); the database applies the same rule (private.user_import_actor_may_import) and lets only
 * the importer move an import on. Updating existing people's data also needs `platform.user.update`.
 * Audit records carry ids, counts, options and codes — never row data (BR-IAM-3, TM-0004 T-PEO-20).
 */
const p = platformPermissions;
const PERMISSION = p['platform.user.invite'];

/**
 * Storage with the signed-in user's session, for `afterCommit` (apps: `requestFileStorage` of
 * @jadarat/platform-files/next). Signing refuses to run inside a transaction (T-M2-18 integration review M1).
 */
export type FileStorageFactory = () => Promise<Parameters<typeof signUploadIntent>[0]>;

function fieldError(path: string, code: string): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

/** The import's database refusals as the screens show them. */
function importRefusal(error: unknown): AppError | null {
  if (!isDomainError(error)) return null;
  switch (error.code) {
    case 'IMPORT_NOT_FOUND':
      return appError('NOT_FOUND');
    case 'NOT_IMPORTER':
    case 'NOT_ALLOWED':
      return appError('FORBIDDEN');
    case 'ANOTHER_IMPORT_RUNNING':
    case 'REVIEW_EXPIRED':
    case 'UNDO_EXPIRED':
    case 'IMPORT_STATE_CHANGED':
      return fieldError('import', error.code);
    case 'TOO_MANY_DRAFTS':
      return fieldError('file', error.code);
    default:
      return null;
  }
}

async function guarded<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: AppError }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const refusal = importRefusal(error);
    if (refusal === null) throw error;
    return { ok: false, error: refusal };
  }
}

/** The importer's own import, or the refusal to show. */
async function ownImport(tx: UserTx, id: string): Promise<UserImportRecord | AppError> {
  const record = await getUserImport(tx, id);
  if (!record) return appError('NOT_FOUND');
  if (!record.mine) return appError('FORBIDDEN');
  return record;
}

const ImportId = z.uuid();

// ---------------------------------------------------------------------------------------------------
// Step 1: the file
// ---------------------------------------------------------------------------------------------------

export const StartUserImportInput = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MAX_IMPORT_FILE_BYTES),
});

export interface StartedUserImport {
  readonly importId: string;
  readonly fileId: string;
  readonly upload: {
    readonly url: string;
    readonly method: 'PUT';
    readonly contentType: string;
    readonly maxBytes: number;
    readonly expiresAt: string;
  };
}

/** What the start handler commits: the import and its upload reservation (signed after the commit). */
export interface ReservedUserImport {
  readonly importId: string;
  readonly reservation: UploadReservation;
}

/**
 * Starts an import, in the files API's two steps (T-M2-18 × T-M2-12; docs/engineering/files.md §3). In the
 * action's transaction: refused while another import runs in the organization; reserves the upload
 * (purpose platform.user_import, owner this import — the files service checks name, type and size) and
 * creates the import. After the commit (`afterCommit`: Storage sees committed rows only, on its own
 * connection; run once, no connection held): Storage signs the upload URL for the browser's PUT. Expected
 * file refusals are error results (`fileResult`: FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE,
 * FILE_TOO_MANY_UPLOADS, FILE_STORAGE_UNAVAILABLE; FORBIDDEN when Storage refuses). The handler's work is
 * all in its transaction, so the action needs no `externalEffects` and may be retried after a conflict.
 * If signing fails, what stays is what a cut upload leaves: an import waiting for its file, whose
 * reservation expires unused (15 minutes) and which ends with that upload window (`UPLOAD_NOT_FINISHED`).
 */
export function startUserImportActionDefinition(
  storage: FileStorageFactory,
): ActionDefinition<typeof StartUserImportInput, ReservedUserImport, UserTx, StartedUserImport> {
  return {
    permission: PERMISSION,
    input: StartUserImportInput,
    handler: async ({ ctx, input }) => {
      if (await getRunningUserImport(ctx.tx))
        return err(fieldError('file', 'ANOTHER_IMPORT_RUNNING'));
      const importId = randomUUID();
      const reserved = await fileResult(
        reserveUploadIntent(ctx.tx, {
          purpose: 'platform.user_import',
          owner: { module: 'platform', entityType: 'user_import', entityId: importId },
          declaredName: input.fileName,
          size: input.size,
        }),
      );
      if (!reserved.ok) return reserved;
      const created = await guarded(() =>
        createUserImport(ctx.tx, {
          id: importId,
          fileId: reserved.value.fileId,
          fileName: sanitizeFileName(input.fileName),
          fileSize: input.size,
        }),
      );
      if (!created.ok) return err(created.error);
      return ok({ importId, reservation: reserved.value });
    },
    afterCommit: async ({ result }) => {
      const signed = await fileResult(signUploadIntent(await storage(), result.reservation));
      if (!signed.ok) return signed;
      const intent = signed.value;
      return ok({
        importId: result.importId,
        fileId: intent.fileId,
        upload: {
          url: intent.url,
          method: intent.method,
          contentType: intent.contentType,
          maxBytes: intent.maxBytes,
          expiresAt: intent.expiresAt.toISOString(),
        },
      });
    },
  };
}

export const UserImportIdInput = z.strictObject({ importId: ImportId });

export interface UploadConfirmed {
  readonly importId: string;
  readonly fileId: string;
  readonly fileStatus: string;
}

/** After the browser's PUT: the upload is confirmed and queued for the virus scan. */
export function confirmUserImportUploadActionDefinition(): ActionDefinition<
  typeof UserImportIdInput,
  UploadConfirmed,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportIdInput,
    handler: async ({ ctx, input }) => {
      const record = await ownImport(ctx.tx, input.importId);
      if ('code' in record) return err(record);
      if (record.status !== 'uploaded') return err(fieldError('import', 'IMPORT_STATE_CHANGED'));
      // No PUT yet (FILE_NOT_UPLOADED), too late (FILE_UPLOAD_EXPIRED), gone (NOT_FOUND): answers, not
      // internal errors; the transaction rolls back.
      const view = await fileResult(confirmUpload(ctx.tx, record.fileId));
      if (!view.ok) return view;
      // The upload window no longer applies: the import is not taken for an abandoned upload
      // (integration review M1).
      const closed = await guarded(() => closeUserImportUploadWindow(ctx.tx, record.id));
      if (!closed.ok) return err(closed.error);
      return ok({ importId: record.id, fileId: record.fileId, fileStatus: view.value.status });
    },
    audit: (_input, output) => ({
      action: 'platform.user_import.uploaded',
      entityType: 'user_import',
      entityId: output.importId,
      data: { fileId: output.fileId },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Step 2: the mapping
// ---------------------------------------------------------------------------------------------------

export const ChooseMappingInput = z.strictObject({
  importId: ImportId,
  sheetIndex: z.number().int().min(0).max(49),
  mapping: z
    .record(z.string().regex(/^(0|[1-9][0-9]{0,2})$/), z.enum(IMPORT_FIELDS))
    .refine((mapping) => Object.keys(mapping).length <= IMPORT_FIELDS.length, {
      message: 'too_many',
    }),
});

/** The sheet and the column mapping, checked against the file's columns; the dry run follows. */
export function chooseUserImportMappingActionDefinition(): ActionDefinition<
  typeof ChooseMappingInput,
  { readonly importId: string },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: ChooseMappingInput,
    handler: async ({ ctx, input }) => {
      const record = await ownImport(ctx.tx, input.importId);
      if ('code' in record) return err(record);
      if (record.status !== 'mapping' && record.status !== 'review') {
        return err(fieldError('import', 'IMPORT_STATE_CHANGED'));
      }
      const sheet = record.sheets[input.sheetIndex];
      if (!sheet) return err(fieldError('sheetIndex', 'NO_SUCH_SHEET'));
      if (sheet.rows < 1) return err(fieldError('sheetIndex', 'SHEET_EMPTY'));
      if (sheet.rows > MAX_IMPORT_ROWS) return err(fieldError('sheetIndex', 'SHEET_TOO_MANY_ROWS'));
      const columns = (await listUserImportColumns(ctx.tx, record.id)).filter(
        (c) => c.sheetIndex === input.sheetIndex,
      );
      const problems = mappingProblems(
        input.mapping,
        columns,
        requiredFields(await getTenantDefaultLocale(ctx.tx)),
      );
      if (problems.length > 0) {
        return err(
          appError('VALIDATION_FAILED', {
            fieldErrors: problems.map((problem) => ({
              path:
                problem.kind === 'missing' || problem.kind === 'twice'
                  ? `mapping.${problem.field}`
                  : `mapping.${String(problem.column)}`,
              code: problem.kind.toUpperCase(),
            })),
          }),
        );
      }
      const chosen = await guarded(() =>
        chooseUserImportMapping(ctx.tx, record.id, {
          sheetIndex: input.sheetIndex,
          mapping: input.mapping,
        }),
      );
      return chosen.ok ? ok({ importId: record.id }) : err(chosen.error);
    },
    audit: (input, output) => ({
      action: 'platform.user_import.mapped',
      entityType: 'user_import',
      entityId: output.importId,
      // Which fields are imported (no file data).
      data: { sheetIndex: input.sheetIndex, fields: Object.values(input.mapping).sort() },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Steps 4–5: options and confirmation; then stop, cancel, undo
// ---------------------------------------------------------------------------------------------------

const IMPORTABLE_ROLE_CODES = IMPORTABLE_ROLES.map((r) => r.code) as [string, ...string[]];

export const ConfirmUserImportInput = z.strictObject({
  importId: ImportId,
  existing: z.enum(['skip', 'upsert', 'update_only']),
  defaultRole: z.enum(IMPORTABLE_ROLE_CODES),
  invitations: z.enum(['send', 'hold']),
});

/** Starts the run with the options of step 4 (never a privileged default role, PO decision 3). */
export function confirmUserImportActionDefinition(): ActionDefinition<
  typeof ConfirmUserImportInput,
  { readonly importId: string; readonly counts: Readonly<Record<string, unknown>> },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: ConfirmUserImportInput,
    handler: async ({ ctx, input }) => {
      // Updating existing people's data is an edit of their details (T-M2-13): platform.user.update too.
      if (input.existing !== 'skip' && !ctx.can(p['platform.user.update'], 'tenant')) {
        return err(appError('FORBIDDEN'));
      }
      const record = await ownImport(ctx.tx, input.importId);
      if ('code' in record) return err(record);
      const confirmed = await guarded(() =>
        confirmUserImport(ctx.tx, record.id, {
          existing: input.existing,
          defaultRole: input.defaultRole,
          invitations: input.invitations,
        }),
      );
      if (!confirmed.ok) return err(confirmed.error);
      return ok({ importId: record.id, counts: record.reviewCounts ?? {} });
    },
    audit: (input, output) => ({
      action: 'platform.user_import.confirmed',
      entityType: 'user_import',
      entityId: output.importId,
      data: {
        options: {
          existing: input.existing,
          defaultRole: input.defaultRole,
          invitations: input.invitations,
        },
        counts: numbersOf(output.counts, [
          'total',
          'new',
          'existing',
          'skipped',
          'errors',
          'warnings',
        ]),
      },
    }),
  };
}

function numbersOf(
  counts: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const value = Number(counts[key] ?? 0);
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** Cancels an import before it runs (its file and data are deleted). */
export function cancelUserImportActionDefinition(): ActionDefinition<
  typeof UserImportIdInput,
  { readonly importId: string },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportIdInput,
    handler: async ({ ctx, input }) => {
      const done = await guarded(() => cancelUserImport(ctx.tx, input.importId));
      return done.ok ? ok({ importId: input.importId }) : err(done.error);
    },
    audit: (_input, output) => ({
      action: 'platform.user_import.cancelled',
      entityType: 'user_import',
      entityId: output.importId,
    }),
  };
}

/** Stops a running import after its current batch (people added so far stay, without invitations). */
export function stopUserImportActionDefinition(): ActionDefinition<
  typeof UserImportIdInput,
  { readonly importId: string },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportIdInput,
    handler: async ({ ctx, input }) => {
      const done = await guarded(() => stopUserImport(ctx.tx, input.importId));
      return done.ok ? ok({ importId: input.importId }) : err(done.error);
    },
    audit: (_input, output) => ({
      action: 'platform.user_import.stop_requested',
      entityType: 'user_import',
      entityId: output.importId,
    }),
  };
}

export const UndoUserImportInput = z.strictObject({
  importId: ImportId,
  reason: z.enum(['wrong_file', 'wrong_data', 'wrong_options', 'other']).nullable(),
});

/**
 * Undoes an import within 7 days (BRD §10.4, PO decision 10); it cannot itself be undone. Its importer,
 * or an Organization Admin for any import of the organization (Tech Lead decision 10 Oct 2026, security
 * review M1) — the database decides.
 */
export function undoUserImportActionDefinition(): ActionDefinition<
  typeof UndoUserImportInput,
  { readonly importId: string; readonly reason: string | null },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UndoUserImportInput,
    handler: async ({ ctx, input }) => {
      const done = await guarded(() => requestUserImportUndo(ctx.tx, input.importId, input.reason));
      return done.ok ? ok({ importId: input.importId, reason: input.reason }) : err(done.error);
    },
    audit: (_input, output) => ({
      action: 'platform.user_import.undo_requested',
      entityType: 'user_import',
      entityId: output.importId,
      data: { reason: output.reason },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// The error report and the review's list of problems (the importer alone; each download audited)
// ---------------------------------------------------------------------------------------------------

export const DownloadReportInput = z.strictObject({
  importId: ImportId,
  which: z.enum(['report', 'review']),
});

export interface ReportLink {
  readonly importId: string;
  readonly which: 'report' | 'review';
  readonly url: string;
  readonly name: string;
}

/** What the download handler commits: the download grant (signed after the commit). */
export interface GrantedReport {
  readonly importId: string;
  readonly which: 'report' | 'review';
  readonly granted: GrantedDownload;
}

/**
 * The error report or the review's list of problems, for the importer alone (T-M2-18 × T-M2-12; files.md
 * §3). In the action's transaction: the import is the actor's own; the download grant for exactly this
 * import's report (`grantDownload`, with the files service's audit event `platform.file.download_granted`)
 * and the import's audit event `platform.user_import.report_downloaded` — both record the grant, the
 * right to download for 60 seconds. After the commit (`afterCommit`): Storage signs the link. A report
 * that is gone or not clean is REPORT_DELETED; a Storage refusal is FILE_STORAGE_UNAVAILABLE or FORBIDDEN
 * (`fileResult`). No `externalEffects`: the handler's work is all in its transaction. If signing fails,
 * the grant expires unused with its 60 seconds.
 */
export function downloadUserImportReportActionDefinition(
  storage: FileStorageFactory,
): ActionDefinition<typeof DownloadReportInput, GrantedReport, UserTx, ReportLink> {
  return {
    permission: PERMISSION,
    input: DownloadReportInput,
    handler: async ({ ctx, input }) => {
      const record = await ownImport(ctx.tx, input.importId);
      if ('code' in record) {
        return err(record.code === 'FORBIDDEN' ? fieldError('import', 'REPORT_NOT_YOURS') : record);
      }
      const fileId = input.which === 'report' ? record.reportFileId : record.reviewFileId;
      if (fileId === null || record.dataPurgedAt !== null) {
        return err(fieldError('import', 'REPORT_DELETED'));
      }
      const granted = await fileResult(
        grantDownload(ctx.tx, ctx.actor, {
          fileId,
          purpose: 'platform.user_import_report',
          owner: { module: 'platform', entityType: 'user_import', entityId: record.id },
        }),
      );
      if (!granted.ok) {
        // Purged or not clean (FILE_NOT_FOUND → NOT_FOUND, FILE_NOT_CLEAN → FILE_NOT_READY): as the
        // screens say it.
        const gone = granted.error.code === 'NOT_FOUND' || granted.error.code === 'FILE_NOT_READY';
        return err(gone ? fieldError('import', 'REPORT_DELETED') : granted.error);
      }
      return ok({ importId: record.id, which: input.which, granted: granted.value });
    },
    audit: (_input, output) => ({
      action: 'platform.user_import.report_downloaded',
      entityType: 'user_import',
      entityId: output.importId,
      data: { which: output.which },
    }),
    afterCommit: async ({ result }) => {
      const link = await fileResult(signDownload(await storage(), result.granted));
      if (!link.ok) return link;
      return ok({
        importId: result.importId,
        which: result.which,
        url: link.value.url,
        name: link.value.name,
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// «لم تُرسل الدعوة»: sending held invitations from the users list or the result page
// ---------------------------------------------------------------------------------------------------

/** Seconds between two invitations sent from the list (the import's pace). */
export const SEND_PACE_SECONDS = 1;

export const SendHeldInvitationsInput = z
  .strictObject({
    invitationIds: z.array(z.uuid()).min(1).max(1000).optional(),
    importId: ImportId.optional(),
  })
  .refine((value) => value.invitationIds === undefined || value.importId === undefined, {
    message: 'one_selection',
  });

export function sendHeldInvitationsActionDefinition(): ActionDefinition<
  typeof SendHeldInvitationsInput,
  { readonly scheduled: number; readonly importId: string | null },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: SendHeldInvitationsInput,
    handler: async ({ ctx, input }) => {
      const sent = await guarded(() =>
        scheduleHeldInvitations(
          ctx.tx,
          {
            ...(input.invitationIds ? { ids: input.invitationIds } : {}),
            ...(input.importId ? { importId: input.importId } : {}),
          },
          SEND_PACE_SECONDS,
        ),
      );
      // Sent for this member (integration review M2): refused up front when they may not invite.
      if (!sent.ok) {
        return err(
          sent.error.code === 'FORBIDDEN'
            ? fieldError('invitations', 'SEND_NOT_ALLOWED')
            : sent.error,
        );
      }
      if (sent.value === 0) return err(fieldError('invitations', 'NOTHING_TO_SEND'));
      return ok({ scheduled: sent.value, importId: input.importId ?? null });
    },
    audit: (_input, output) => ({
      action: 'platform.invitation.send_requested',
      entityType: output.importId === null ? 'invitation' : 'user_import',
      ...(output.importId === null ? {} : { entityId: output.importId }),
      data: { count: output.scheduled },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

export interface UserImportStartView {
  /** The import running now (others cannot start one: «يجري استيراد آخر الآن»). */
  readonly running: UserImportRecord | null;
  readonly recent: readonly UserImportRecord[];
  /** The language whose first and family names are required (the organization's default, PO 17 Oct 2026). */
  readonly nameLanguage: NameLanguage;
}

/** Step 1: the organization's running and latest imports. */
export function userImportStartQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  UserImportStartView,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: z.strictObject({}),
    handler: async ({ ctx }) =>
      ok({
        running: await getRunningUserImport(ctx.tx),
        recent: await listUserImports(ctx.tx, 10),
        nameLanguage: await getTenantDefaultLocale(ctx.tx),
      }),
  };
}

export interface MappingColumnView extends UserImportColumn {
  readonly recognition: ColumnRecognition;
}

export interface UserImportView {
  readonly record: UserImportRecord;
  /** The importer's own staged columns with their recognition (others: empty). */
  readonly columns: readonly MappingColumnView[];
  readonly running: UserImportRecord | null;
  /** May update existing people's data (options «إضافة وتحديث», «تحديث فقط»). */
  readonly canUpdate: boolean;
  /** The roles an import may give (the default role's list). */
  readonly roles: readonly string[];
  readonly required: readonly string[];
  /** The language whose first and family names are required (the organization's default, PO 17 Oct 2026). */
  readonly nameLanguage: NameLanguage;
  readonly maxRows: number;
  readonly undo: UndoPreview | null;
  readonly privilegedAccess: PermissionAccess;
}

/** One import, as each step and the result page show it. */
/**
 * What the import page shows of the worker's progress, as one opaque value (T-M2-12 integration review
 * L1): the status, its reasons, the file's scan, the rows done and the counts — not timestamps the worker
 * moves without anything to show (leases, next attempts). The page and its status read compare it; a
 * hash, so no counts or codes travel in it.
 */
export function userImportVersion(record: UserImportRecord): string {
  const shown = [
    record.status,
    record.failureCode,
    record.fileStatus,
    record.fileStatusReason,
    record.rowsDone,
    record.rowsTotal,
    record.sheets.length,
    record.stopRequestedAt?.toISOString() ?? null,
    record.undoRequestedAt?.toISOString() ?? null,
    record.reviewCounts,
    record.resultCounts,
    record.reportCode,
    record.reportFileId,
    record.dataPurgedAt?.toISOString() ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(shown)).digest('base64url').slice(0, 22);
}

/**
 * «Is there anything new?» — what the import page polls while the worker works (T-M2-12 integration
 * review L1). A **passive read** (platform-db PASSIVE_READS): read-only, and NOT the session's activity, so
 * a page left open cannot keep an idle session alive (the organization's inactivity rule, T-M2-10); the
 * page refreshes itself only when the version changed. Same permission and visibility as the page.
 */
export function userImportStatusQueryDefinition(): QueryDefinition<
  typeof UserImportIdInput,
  { readonly version: string },
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportIdInput,
    passiveRead: 'platform.user_import.status',
    handler: async ({ ctx, input }) => {
      const record = await getUserImport(ctx.tx, input.importId);
      if (!record) return err(appError('NOT_FOUND'));
      return ok({ version: userImportVersion(record) });
    },
  };
}

export function userImportQueryDefinition(): QueryDefinition<
  typeof UserImportIdInput,
  UserImportView,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportIdInput,
    handler: async ({ ctx, input }) => {
      const record = await getUserImport(ctx.tx, input.importId);
      if (!record) return err(appError('NOT_FOUND'));
      const nameLanguage = await getTenantDefaultLocale(ctx.tx);
      let columns: MappingColumnView[] = [];
      if (record.mine && record.dataPurgedAt === null) {
        const all = await listUserImportColumns(ctx.tx, record.id);
        for (let sheet = 0; sheet < record.sheets.length; sheet += 1) {
          const ofSheet = all.filter((c) => c.sheetIndex === sheet);
          const recognized = recognizeColumns(ofSheet);
          ofSheet.forEach((column, i) => {
            columns.push({ ...column, recognition: recognized[i] ?? { kind: 'unknown' } });
          });
        }
      } else {
        columns = [];
      }
      // Its importer, or an Organization Admin (Tech Lead decision 10 Oct 2026): the preview is counts only.
      const undo =
        record.mayUndo &&
        ['finished', 'stopped', 'failed'].includes(record.status) &&
        record.dataPurgedAt === null
          ? await getUndoPreview(ctx.tx, record.id)
          : null;
      return ok({
        record,
        columns,
        running: await getRunningUserImport(ctx.tx),
        canUpdate: ctx.can(p['platform.user.update'], 'tenant'),
        roles: IMPORTABLE_ROLE_CODES,
        required: requiredFields(nameLanguage),
        nameLanguage,
        maxRows: MAX_IMPORT_ROWS,
        undo,
        privilegedAccess: ctx.access(p['platform.role.assign_privileged'], 'tenant'),
      });
    },
  };
}

export const UserImportRowsInput = z.strictObject({
  importId: ImportId,
  view: z.enum(['errors', 'warnings', 'existing', 'skipped', 'all']).default('errors'),
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const ROWS_PAGE_SIZE = 25;

export interface UserImportRowsView {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly ImportRowView[];
}

/** A page of the review's rows (the importer alone: they hold the file's data). */
export function userImportRowsQueryDefinition(): QueryDefinition<
  typeof UserImportRowsInput,
  UserImportRowsView,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: UserImportRowsInput,
    handler: async ({ ctx, input }) => {
      const record = await ownImport(ctx.tx, input.importId);
      if ('code' in record) return err(record);
      const page = await listUserImportRows(ctx.tx, record.id, {
        view: input.view,
        code: input.code,
        offset: (input.page - 1) * ROWS_PAGE_SIZE,
        limit: ROWS_PAGE_SIZE,
      });
      return ok({ total: page.total, page: input.page, pageSize: ROWS_PAGE_SIZE, rows: page.rows });
    },
  };
}

export interface UserImportBannersView {
  readonly running: UserImportRecord | null;
  readonly held: HeldInvitationsSummary;
}

/** The users list's banners: a running import, people added without invitations (screen 1). */
export function userImportBannersQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  UserImportBannersView,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: z.strictObject({}),
    handler: async ({ ctx }) =>
      ok({
        running: await getRunningUserImport(ctx.tx),
        held: await getHeldInvitationsSummary(ctx.tx),
      }),
  };
}

/**
 * The template's lists: this organization's departments and branches (with codes), and the language whose
 * names are required (its columns come first, marked required).
 */
export function userImportTemplateQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  TemplateLists,
  UserTx
> {
  return {
    permission: PERMISSION,
    input: z.strictObject({}),
    handler: async ({ ctx }) =>
      ok({
        ...(ctx.can(p['platform.org.read'], 'tenant')
          ? await listTemplateUnits(ctx.tx)
          : { departments: [], branches: [] }),
        nameLanguage: await getTenantDefaultLocale(ctx.tx),
      }),
  };
}
