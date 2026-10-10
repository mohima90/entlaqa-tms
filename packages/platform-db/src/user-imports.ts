import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { emitEvent } from './events';
import { pgError } from './user-admin';

/**
 * Bulk user imports, request path (T-M2-12, FR-IAM-04; migrations 20261016090000…090200;
 * docs/engineering/user-import.md). Runs in the signed-in member's withUserTx: RLS shows the imports to
 * user managers (Organization Admin, HR Manager), the staged columns and rows to the importer alone, and
 * the lifecycle trigger (private.check_user_import) allows only the importer's moves. The worker does
 * everything else (./jobs/user-imports.ts). Audit events are the calling action's job.
 */

export type UserImportStatus =
  | 'uploaded'
  | 'rejected'
  | 'mapping'
  | 'validating'
  | 'review'
  | 'queued'
  | 'checking'
  | 'importing'
  | 'inviting'
  | 'finished'
  | 'stopped'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'undoing'
  | 'undone';

/** One import at a time per organization (TM-0003 T-IAM-34): these statuses. */
export const USER_IMPORT_RUNNING: readonly UserImportStatus[] = [
  'queued',
  'checking',
  'importing',
  'inviting',
  'undoing',
];
/** Before the run starts (cancellable; the review expires). */
export const USER_IMPORT_DRAFT: readonly UserImportStatus[] = [
  'uploaded',
  'mapping',
  'validating',
  'review',
];

export const USER_IMPORT_EVENTS = {
  /** The run was confirmed (subject: the import): wakes the worker at once. */
  confirmed: 'com.entlaqa.platform.user_import.confirmed',
  /** An undo was asked for. */
  undoRequested: 'com.entlaqa.platform.user_import.undo_requested',
  /** The mapping was chosen (the dry run follows). */
  mapped: 'com.entlaqa.platform.user_import.mapped',
  /** Held invitations were scheduled for sending from the users list. */
  invitationsScheduled: 'com.entlaqa.platform.user_import.invitations_scheduled',
} as const;

export type UserImportErrorCode =
  | 'IMPORT_NOT_FOUND'
  /** Someone else's import: only its importer moves it on. */
  | 'NOT_IMPORTER'
  /** The importer may no longer import (no longer Organization Admin or HR Manager). */
  | 'NOT_ALLOWED'
  | 'ANOTHER_IMPORT_RUNNING'
  | 'REVIEW_EXPIRED'
  | 'UNDO_EXPIRED'
  /** The import is no longer in the step the request was made for (e.g. confirmed twice). */
  | 'IMPORT_STATE_CHANGED';

export interface UserImportOptions {
  readonly existing: 'skip' | 'upsert' | 'update_only';
  readonly defaultRole: string;
  readonly invitations: 'send' | 'hold';
}

export interface UserImportSheet {
  readonly name: string;
  readonly rows: number;
  readonly columns: number;
  readonly hidden?: boolean;
  readonly headerRow?: number | null;
}

export interface UserImportInvitationCounts {
  /** Not sent yet and not scheduled («لم تُرسل الدعوة»). */
  readonly held: number;
  /** Not sent yet, due to go out shortly. */
  readonly scheduled: number;
  /** E-mailed (pending, accepted or revoked since). */
  readonly sent: number;
  readonly accepted: number;
}

export interface UserImportRecord {
  readonly id: string;
  readonly status: UserImportStatus;
  readonly failureCode: string | null;
  readonly fileId: string;
  readonly fileName: string;
  readonly fileSize: number;
  /** The importer (Auth user) and their person; `mine`: the signed-in member is the importer. */
  readonly createdBy: string;
  readonly importerName: { readonly ar: string | null; readonly en: string | null };
  readonly mine: boolean;
  readonly sheets: readonly UserImportSheet[];
  readonly sheetIndex: number | null;
  readonly mapping: Readonly<Record<string, string>> | null;
  readonly options: UserImportOptions | null;
  readonly reviewCounts: Readonly<Record<string, unknown>> | null;
  readonly resultCounts: Readonly<Record<string, unknown>> | null;
  readonly rowsTotal: number;
  readonly rowsDone: number;
  readonly stopRequestedAt: Date | null;
  readonly undoRequestedAt: Date | null;
  readonly undoReason: string | null;
  readonly reviewFileId: string | null;
  readonly reportFileId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly readAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly undoneAt: Date | null;
  readonly reviewExpiresAt: Date;
  readonly dataPurgedAt: Date | null;
  /** The uploaded file's status as its uploader sees it (null for anyone else, or once purged). */
  readonly fileStatus: string | null;
  readonly fileStatusReason: string | null;
  readonly invitations: UserImportInvitationCounts;
}

type Row = Record<string, unknown>;

const toDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));
const toDateOrNull = (value: unknown): Date | null =>
  value === null || value === undefined ? null : toDate(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const int = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const obj = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function optionsOf(value: unknown): UserImportOptions | null {
  const o = obj(value);
  if (!o) return null;
  const existing = o.existing;
  const invitations = o.invitations;
  if (
    (existing !== 'skip' && existing !== 'upsert' && existing !== 'update_only') ||
    (invitations !== 'send' && invitations !== 'hold') ||
    typeof o.defaultRole !== 'string'
  ) {
    return null;
  }
  return { existing, invitations, defaultRole: o.defaultRole };
}

function sheetsOf(value: unknown): UserImportSheet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = obj(item);
    if (!o) return [];
    return [
      {
        name: typeof o.name === 'string' ? o.name : '',
        rows: int(o.rows),
        columns: int(o.columns),
        ...(typeof o.hidden === 'boolean' ? { hidden: o.hidden } : {}),
        ...(typeof o.headerRow === 'number' || o.headerRow === null
          ? { headerRow: o.headerRow }
          : {}),
      },
    ];
  });
}

const SELECT = sql`
  select i.id, i.status, i.failure_code, i.file_id, i.file_name, i.file_size, i.created_by,
         p.display_name_ar as importer_ar, p.display_name_en as importer_en,
         i.created_by = private.request_user_id() as mine,
         i.sheets, i.sheet_index, i.mapping, i.options, i.review_counts, i.result_counts, i.rows_total,
         i.rows_done, i.stop_requested_at, i.undo_requested_at, i.undo_reason, i.review_file_id,
         i.report_file_id, i.created_at, i.updated_at, i.read_at, i.reviewed_at, i.confirmed_at,
         i.started_at, i.finished_at, i.undone_at, i.review_expires_at, i.data_purged_at,
         f.status as file_status, f.status_reason as file_status_reason,
         coalesce(v.held, 0) as held, coalesce(v.scheduled, 0) as scheduled, coalesce(v.sent, 0) as sent,
         coalesce(v.accepted, 0) as accepted
  from platform.user_imports i
  left join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.created_by_person
  left join platform.files f on f.tenant_id = i.tenant_id and f.id = i.file_id and f.purged_at is null
  left join lateral (
    select count(*) filter (where x.status = 'pending' and x.mail_held and x.send_at is null) as held,
           count(*) filter (where x.status = 'pending' and x.mail_held and x.send_at is not null) as scheduled,
           count(*) filter (where not x.mail_held) as sent,
           count(*) filter (where x.status = 'accepted') as accepted
    from platform.invitations x
    where x.tenant_id = i.tenant_id and x.import_id = i.id) v on true`;

function recordOf(r: Row): UserImportRecord {
  return {
    id: String(r.id),
    status: r.status as UserImportStatus,
    failureCode: str(r.failure_code),
    fileId: String(r.file_id),
    fileName: String(r.file_name),
    fileSize: int(r.file_size),
    createdBy: String(r.created_by),
    importerName: { ar: str(r.importer_ar), en: str(r.importer_en) },
    mine: r.mine === true,
    sheets: sheetsOf(r.sheets),
    sheetIndex: r.sheet_index === null || r.sheet_index === undefined ? null : int(r.sheet_index),
    mapping: obj(r.mapping) as Record<string, string> | null,
    options: optionsOf(r.options),
    reviewCounts: obj(r.review_counts),
    resultCounts: obj(r.result_counts),
    rowsTotal: int(r.rows_total),
    rowsDone: int(r.rows_done),
    stopRequestedAt: toDateOrNull(r.stop_requested_at),
    undoRequestedAt: toDateOrNull(r.undo_requested_at),
    undoReason: str(r.undo_reason),
    reviewFileId: str(r.review_file_id),
    reportFileId: str(r.report_file_id),
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
    readAt: toDateOrNull(r.read_at),
    reviewedAt: toDateOrNull(r.reviewed_at),
    confirmedAt: toDateOrNull(r.confirmed_at),
    startedAt: toDateOrNull(r.started_at),
    finishedAt: toDateOrNull(r.finished_at),
    undoneAt: toDateOrNull(r.undone_at),
    reviewExpiresAt: toDate(r.review_expires_at),
    dataPurgedAt: toDateOrNull(r.data_purged_at),
    fileStatus: str(r.file_status),
    fileStatusReason: str(r.file_status_reason),
    invitations: {
      held: int(r.held),
      scheduled: int(r.scheduled),
      sent: int(r.sent),
      accepted: int(r.accepted),
    },
  };
}

/** Maps the database's refusals of an import change to DomainErrors; anything else is returned as is. */
export function userImportErrorOf(error: unknown): unknown {
  const pg = pgError(error);
  if (!pg) return error;
  const refuse = (code: UserImportErrorCode) => new DomainError(code, { cause: error });
  if (pg.code === '23505' && pg.constraint === 'user_imports_one_running_uq') {
    return refuse('ANOTHER_IMPORT_RUNNING');
  }
  if (pg.code === '42501') {
    return refuse(
      pg.message.includes('only the person who started') ? 'NOT_IMPORTER' : 'NOT_ALLOWED',
    );
  }
  if (pg.code === '23514') {
    if (pg.message.includes('review of this import has expired')) return refuse('REVIEW_EXPIRED');
    if (pg.message.includes('can no longer be undone')) return refuse('UNDO_EXPIRED');
    return refuse('IMPORT_STATE_CHANGED');
  }
  return error;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw userImportErrorOf(error);
  }
}

/**
 * Starts an import for the file the importer just reserved for it (purpose `platform.user_import`, owner
 * this import): status `uploaded`. The database stamps the importer from the claims and checks the file is
 * their own upload for this import. Throws DomainError NOT_ALLOWED.
 */
export async function createUserImport(
  tx: ClaimsTx,
  input: {
    readonly id: string;
    readonly fileId: string;
    readonly fileName: string;
    readonly fileSize: number;
  },
): Promise<void> {
  await guarded(() =>
    tx.execute(sql`
      insert into platform.user_imports (id, file_id, file_name, file_size)
      values (${input.id}::uuid, ${input.fileId}::uuid, ${input.fileName}, ${input.fileSize})`),
  );
}

/** An import of the organization (user managers), or null. */
export async function getUserImport(tx: ClaimsTx, id: string): Promise<UserImportRecord | null> {
  const rows = await tx.execute<Row>(sql`${SELECT} where i.id = ${id}::uuid`);
  const row = rows[0];
  return row ? recordOf(row) : null;
}

/** The organization's latest imports, newest first («عمليات الاستيراد الأخيرة»). */
export async function listUserImports(tx: ClaimsTx, limit = 10): Promise<UserImportRecord[]> {
  const rows = await tx.execute<Row>(
    sql`${SELECT} order by i.created_at desc, i.id limit ${Math.max(1, Math.min(limit, 50))}`,
  );
  return rows.map(recordOf);
}

/** The import running now in the organization (at most one), or null. */
export async function getRunningUserImport(tx: ClaimsTx): Promise<UserImportRecord | null> {
  const rows = await tx.execute<Row>(
    sql`${SELECT} where i.status in ('queued', 'checking', 'importing', 'inviting', 'undoing') limit 1`,
  );
  const row = rows[0];
  return row ? recordOf(row) : null;
}

export interface HeldInvitationsSummary {
  /** Held invitations of the organization (not sent, not scheduled). */
  readonly total: number;
  /** The latest import that left people «لم تُرسل الدعوة», with how many of them. */
  readonly latest: {
    readonly importId: string;
    readonly fileName: string;
    readonly held: number;
  } | null;
}

export async function getHeldInvitationsSummary(tx: ClaimsTx): Promise<HeldInvitationsSummary> {
  const rows = await tx.execute<{
    import_id: string;
    file_name: string;
    held: number | string;
  }>(sql`
    select v.import_id, i.file_name, count(*) as held
    from platform.invitations v
    join platform.user_imports i on i.tenant_id = v.tenant_id and i.id = v.import_id
    where v.status = 'pending' and v.mail_held and v.send_at is null
    group by v.import_id, i.file_name, i.created_at
    order by i.created_at desc`);
  const total = rows.reduce((sum, row) => sum + Number(row.held), 0);
  const first = rows[0];
  return {
    total,
    latest: first
      ? { importId: first.import_id, fileName: first.file_name, held: Number(first.held) }
      : null,
  };
}

export interface UserImportColumn {
  readonly sheetIndex: number;
  readonly index: number;
  readonly header: string;
  readonly samples: readonly string[];
}

/** The staged columns of an import (header and samples): its importer only (else empty). */
export async function listUserImportColumns(tx: ClaimsTx, id: string): Promise<UserImportColumn[]> {
  const rows = await tx.execute<{
    sheet_index: number | string;
    column_index: number | string;
    header: string;
    samples: string[];
  }>(sql`
    select sheet_index, column_index, header, samples from platform.user_import_columns
    where import_id = ${id}::uuid order by sheet_index, column_index`);
  return rows.map((r) => ({
    sheetIndex: Number(r.sheet_index),
    index: Number(r.column_index),
    header: r.header,
    samples: r.samples,
  }));
}

/**
 * Moves the importer's own import on (the trigger decides whether the move is allowed now). Throws
 * DomainError IMPORT_NOT_FOUND, NOT_IMPORTER, NOT_ALLOWED, REVIEW_EXPIRED, UNDO_EXPIRED,
 * ANOTHER_IMPORT_RUNNING or IMPORT_STATE_CHANGED.
 */
async function moveOwnImport(
  tx: ClaimsTx,
  id: string,
  set: ReturnType<typeof sql>,
  from: readonly UserImportStatus[],
): Promise<void> {
  const [current] = await tx.execute<{ status: UserImportStatus; mine: boolean }>(sql`
    select status, created_by = private.request_user_id() as mine
    from platform.user_imports where id = ${id}::uuid`);
  if (!current) throw new DomainError<UserImportErrorCode>('IMPORT_NOT_FOUND');
  if (!current.mine) throw new DomainError<UserImportErrorCode>('NOT_IMPORTER');
  if (!from.includes(current.status))
    throw new DomainError<UserImportErrorCode>('IMPORT_STATE_CHANGED');
  const updated = await guarded(() =>
    tx.execute(sql`update platform.user_imports set ${set} where id = ${id}::uuid returning id`),
  );
  if (updated.length === 0) throw new DomainError<UserImportErrorCode>('IMPORT_STATE_CHANGED');
}

/** The sheet and the mapping ({column index: field}); the dry run follows (status `validating`). */
export async function chooseUserImportMapping(
  tx: ClaimsTx,
  id: string,
  input: { readonly sheetIndex: number; readonly mapping: Readonly<Record<string, string>> },
): Promise<void> {
  await moveOwnImport(
    tx,
    id,
    sql`status = 'validating', sheet_index = ${input.sheetIndex}, mapping = ${JSON.stringify(input.mapping)}::jsonb`,
    ['mapping', 'review'],
  );
  await emitEvent(tx, { type: USER_IMPORT_EVENTS.mapped, subject: id });
}

/** Confirms the run with its options (status `queued`); the worker starts at once. */
export async function confirmUserImport(
  tx: ClaimsTx,
  id: string,
  options: UserImportOptions,
): Promise<void> {
  await moveOwnImport(
    tx,
    id,
    sql`status = 'queued', options = ${JSON.stringify({
      existing: options.existing,
      defaultRole: options.defaultRole,
      invitations: options.invitations,
    })}::jsonb`,
    ['review'],
  );
  await emitEvent(tx, { type: USER_IMPORT_EVENTS.confirmed, subject: id });
}

/** Cancels an import before it runs: the file and the staged data are deleted by the worker. */
export async function cancelUserImport(tx: ClaimsTx, id: string): Promise<void> {
  await moveOwnImport(tx, id, sql`status = 'cancelled'`, USER_IMPORT_DRAFT);
}

/** Asks a running import to stop after its current batch. */
export async function stopUserImport(tx: ClaimsTx, id: string): Promise<void> {
  await moveOwnImport(tx, id, sql`stop_requested_at = now()`, [
    'queued',
    'checking',
    'importing',
    'inviting',
  ]);
}

export type UndoReason = 'wrong_file' | 'wrong_data' | 'wrong_options' | 'other';

/** Asks for the undo (within 7 days of the end); the worker undoes it in batches. */
export async function requestUserImportUndo(
  tx: ClaimsTx,
  id: string,
  reason: UndoReason | null,
): Promise<void> {
  await moveOwnImport(tx, id, sql`status = 'undoing', undo_reason = ${reason}`, [
    'finished',
    'stopped',
    'failed',
  ]);
  await emitEvent(tx, { type: USER_IMPORT_EVENTS.undoRequested, subject: id });
}

export interface UndoPreview {
  /** People the import added. */
  readonly added: number;
  /** Of them, people who accepted their invitation (they stay). */
  readonly accepted: number;
  /** Members whose data the import changed (their previous values come back unless changed since). */
  readonly updated: number;
}

/** What an undo would do, in counts (the importer only: the staged rows are theirs). */
export async function getUndoPreview(tx: ClaimsTx, id: string): Promise<UndoPreview> {
  const [row] = await tx.execute<{
    added: number | string;
    accepted: number | string;
    updated: number | string;
  }>(sql`
    select count(*) filter (where r.result = 'added') as added,
           count(*) filter (where r.result = 'added' and (v.status = 'accepted'
                            or exists (select 1 from platform.tenant_memberships m
                                       where m.tenant_id = r.tenant_id and m.person_id = r.person_id))) as accepted,
           count(*) filter (where r.result = 'updated') as updated
    from platform.user_import_rows r
    left join platform.invitations v on v.tenant_id = r.tenant_id and v.id = r.invitation_id
    where r.import_id = ${id}::uuid`);
  return {
    added: Number(row?.added ?? 0),
    accepted: Number(row?.accepted ?? 0),
    updated: Number(row?.updated ?? 0),
  };
}

export type ImportRowsView = 'errors' | 'warnings' | 'existing' | 'skipped' | 'all';

export interface ImportRowView {
  readonly rowNumber: number;
  readonly email: string | null;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly kind: string | null;
  readonly issues: unknown;
  readonly changes: unknown;
  readonly result: string | null;
  readonly resultIssues: unknown;
}

/**
 * A page of the staged rows for the review (the importer only): rows with errors, warnings, existing
 * people, skipped rows, or all; optionally those with one issue code.
 */
export async function listUserImportRows(
  tx: ClaimsTx,
  id: string,
  filter: {
    readonly view: ImportRowsView;
    readonly code?: string | undefined;
    readonly offset: number;
    readonly limit: number;
  },
): Promise<{ readonly total: number; readonly rows: ImportRowView[] }> {
  const where = sql.join(
    [
      sql`r.import_id = ${id}::uuid`,
      filter.view === 'errors'
        ? sql`r.review_kind = 'error'`
        : filter.view === 'warnings'
          ? sql`r.review_kind in ('new', 'existing') and r.issues @> '[{"s": "w"}]'`
          : filter.view === 'existing'
            ? sql`r.review_kind = 'existing'`
            : filter.view === 'skipped'
              ? sql`r.review_kind = 'skip'`
              : sql`true`,
      filter.code === undefined
        ? sql`true`
        : sql`r.issues @> ${JSON.stringify([{ c: filter.code }])}::jsonb`,
    ],
    sql` and `,
  );
  const [count] = await tx.execute<{ total: number | string }>(
    sql`select count(*) as total from platform.user_import_rows r where ${where}`,
  );
  const rows = await tx.execute<Row>(sql`
    select r.row_number, coalesce(r.data ->> 'email', r.cells ->> 'email') as email,
           nullif(concat_ws(' ', coalesce(r.data ->> 'first_name_ar', r.cells ->> 'first_name_ar'),
                            coalesce(r.data ->> 'family_name_ar', r.cells ->> 'family_name_ar')), '') as name_ar,
           nullif(concat_ws(' ', r.data ->> 'first_name_en', r.data ->> 'family_name_en'), '') as name_en,
           r.review_kind, r.issues, r.changes, r.result, r.result_issues
    from platform.user_import_rows r
    where ${where}
    order by r.row_number
    offset ${Math.max(0, filter.offset)} limit ${Math.max(1, Math.min(filter.limit, 100))}`);
  return {
    total: Number(count?.total ?? 0),
    rows: rows.map((r) => ({
      rowNumber: int(r.row_number),
      email: str(r.email),
      nameAr: str(r.name_ar),
      nameEn: str(r.name_en),
      kind: str(r.review_kind),
      issues: r.issues,
      changes: r.changes,
      result: str(r.result),
      resultIssues: r.result_issues,
    })),
  };
}

/**
 * Sends held invitations («إرسال الدعوات»): schedules them one after the other at the given pace after
 * the organization's last scheduled one; the worker sends those due. `ids` null: every held invitation
 * of the organization (or of one import). Returns how many were scheduled. The database checks the
 * member may manage each one (the rules of a resend); throws DomainError NOT_ALLOWED otherwise.
 */
export async function scheduleHeldInvitations(
  tx: ClaimsTx,
  selection: { readonly ids?: readonly string[]; readonly importId?: string },
  paceSeconds: number,
): Promise<number> {
  const ids =
    selection.ids !== undefined
      ? sql`${`{${selection.ids.join(',')}}`}::uuid[]`
      : sql`array(select v.id from platform.invitations v
                   where v.status = 'pending' and v.mail_held and v.send_at is null
                     and (${selection.importId ?? null}::uuid is null or v.import_id = ${selection.importId ?? null}::uuid))`;
  const [row] = await guarded(() =>
    tx.execute<{ scheduled: number | string }>(sql`
      select private.schedule_held_invitations(${ids}, make_interval(secs => ${paceSeconds})) as scheduled`),
  );
  const scheduled = Number(row?.scheduled ?? 0);
  if (scheduled > 0) {
    await emitEvent(tx, {
      type: USER_IMPORT_EVENTS.invitationsScheduled,
      data: { count: scheduled },
    });
  }
  return scheduled;
}

export interface TemplateUnitRow {
  readonly code: string | null;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

/** Departments and branches (with their codes) for the import template's «القوائم» sheet. */
export async function listTemplateUnits(
  tx: ClaimsTx,
): Promise<{ readonly departments: TemplateUnitRow[]; readonly branches: TemplateUnitRow[] }> {
  const read = async (table: 'departments' | 'branches') => {
    const rows = await tx.execute<{ code: string | null; name_ar: string; name_en: string | null }>(
      table === 'departments'
        ? sql`select code, name_ar, name_en from platform.departments
              where deleted_at is null order by sort_order, name_ar, id limit 2000`
        : sql`select code, name_ar, name_en from platform.branches
              where deleted_at is null order by is_headquarters desc, name_ar, id limit 2000`,
    );
    return rows.map((r) => ({ code: r.code, nameAr: r.name_ar, nameEn: r.name_en }));
  };
  return { departments: await read('departments'), branches: await read('branches') };
}
