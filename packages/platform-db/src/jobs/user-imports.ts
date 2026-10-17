import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';
import { ENGLISH_ONLY_NAMES_SQL } from '../custom-roles-present';
import { DomainError } from '../domain-error';
import { pgError } from '../user-admin';
import type { UserImportOptions, UserImportStatus } from '../user-imports';

/**
 * Bulk user imports, worker side (T-M2-12, FR-IAM-04, ADR 0005; migrations 20261016090000…090200). The
 * platform task claims the next import that needs a step across organizations
 * (private.claim_user_import_work, under withPlatformTx) and then works in the import's own tenant
 * transaction (withSystemTx), each transaction checking the lease it holds. Ids, statuses and counts
 * only in what is returned to logs; staged row data only for the error report.
 */
export type UserImportStep = 'expire' | 'read' | 'validate' | 'run' | 'undo' | 'send' | 'purge';

export interface UserImportClaim {
  readonly tenantId: string;
  readonly importId: string;
  readonly step: UserImportStep;
  readonly leaseToken: string;
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  return typeof value === 'string' ? new Date(value) : null;
}

const STEPS: readonly UserImportStep[] = [
  'expire',
  'read',
  'validate',
  'run',
  'undo',
  'send',
  'purge',
];

/** Leases the next import with work (15 minutes), or null. withPlatformTx (system claims, no tenant). */
export async function claimUserImportWork(tx: ClaimsTx): Promise<UserImportClaim | null> {
  const [row] = await tx.execute<{
    tenant_id: string;
    import_id: string;
    step: string;
    lease_token: string;
  }>(sql`select * from private.claim_user_import_work()`);
  if (!row?.import_id || !STEPS.includes(row.step as UserImportStep)) return null;
  return {
    tenantId: row.tenant_id,
    importId: row.import_id,
    step: row.step as UserImportStep,
    leaseToken: row.lease_token,
  };
}

export interface UserImportJobView {
  readonly id: string;
  readonly status: UserImportStatus;
  /** The step the import needs now (null: none — it changed since the claim). */
  readonly step: UserImportStep | null;
  readonly createdBy: string;
  readonly fileId: string;
  readonly fileName: string;
  readonly fileStatus: string | null;
  readonly fileStatusReason: string | null;
  readonly fileType: string | null;
  readonly sheets: readonly Record<string, unknown>[];
  readonly sheetIndex: number | null;
  readonly mapping: Readonly<Record<string, string>> | null;
  readonly options: UserImportOptions | null;
  readonly rowsTotal: number;
  readonly rowsDone: number;
  readonly stopRequested: boolean;
  readonly reviewFileId: string | null;
  readonly reportFileId: string | null;
  readonly confirmedAt: Date | null;
  readonly failures: number;
  /** The importer's preferred language (their reports' headers). */
  readonly importerLocale: 'ar' | 'en';
  /**
   * The language whose first and family names each row must give: the organization's default language
   * (guided-test feedback #2, PO 17 Oct 2026; English when it has no settings) — Arabic while the database
   * still requires an Arabic name (englishOnlyNamesExist).
   */
  readonly nameLanguage: 'ar' | 'en';
  /**
   * The importer may still import now (active Organization Admin or HR Manager): the reports are theirs
   * alone, so none is made otherwise (security review M1).
   */
  readonly importerMayImport: boolean;
  /**
   * Still waiting for its file after the upload window (integration review M1): the `expire` step ends it
   * with UPLOAD_NOT_FINISHED instead of the review's expiry.
   */
  readonly uploadAbandoned: boolean;
}

/**
 * The import as the step needs it, in its tenant transaction — locked, and only while `leaseToken` still
 * holds the lease (null otherwise: another worker took over, or the step changed).
 */
export async function loadUserImportForJob(
  tx: ClaimsTx,
  id: string,
  leaseToken: string,
): Promise<UserImportJobView | null> {
  const [row] = await tx.execute(sql`
    select i.id, i.status, i.created_by, i.file_id, i.file_name, i.sheets, i.sheet_index, i.mapping,
           i.options, i.rows_total, i.rows_done, i.stop_requested_at is not null as stop_requested,
           i.review_file_id, i.report_file_id, i.confirmed_at, i.failures,
           f.status as file_status, f.status_reason as file_status_reason, f.detected_mime as file_type,
           coalesce(p.preferred_locale, 'ar') as importer_locale,
           (select s.default_locale from platform.tenant_settings s where s.tenant_id = i.tenant_id) as name_language,
           ${ENGLISH_ONLY_NAMES_SQL} as english_only_names,
           private.user_import_actor_may_import(i.tenant_id, i.created_by) as importer_may_import,
           private.user_import_step(i.tenant_id, i.id, i.status, i.review_expires_at, i.finished_at,
                                    i.undone_at, i.confirmed_at, i.data_purged_at, f.status,
                                    i.upload_due_at) as step,
           private.user_import_upload_abandoned(i.status, i.upload_due_at) as upload_abandoned
    from platform.user_imports i
    left join platform.files f on f.tenant_id = i.tenant_id and f.id = i.file_id and f.purged_at is null
    left join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.created_by_person
    where i.id = ${id}::uuid and i.lease_token = ${leaseToken}::uuid and i.lease_until > now()
    for update of i`);
  if (!row) return null;
  const options = row.options as Record<string, unknown> | null;
  return {
    id: String(row.id),
    status: row.status as UserImportStatus,
    step: STEPS.includes(row.step as UserImportStep) ? (row.step as UserImportStep) : null,
    createdBy: String(row.created_by),
    fileId: String(row.file_id),
    fileName: String(row.file_name),
    fileStatus: (row.file_status as string | null) ?? null,
    fileStatusReason: (row.file_status_reason as string | null) ?? null,
    fileType: (row.file_type as string | null) ?? null,
    sheets: Array.isArray(row.sheets) ? (row.sheets as Record<string, unknown>[]) : [],
    sheetIndex: row.sheet_index === null ? null : Number(row.sheet_index),
    mapping: (row.mapping as Record<string, string> | null) ?? null,
    options:
      options === null
        ? null
        : {
            existing: options.existing as UserImportOptions['existing'],
            defaultRole: String(options.defaultRole),
            invitations: options.invitations as UserImportOptions['invitations'],
          },
    rowsTotal: Number(row.rows_total),
    rowsDone: Number(row.rows_done),
    stopRequested: row.stop_requested === true,
    reviewFileId: (row.review_file_id as string | null) ?? null,
    reportFileId: (row.report_file_id as string | null) ?? null,
    confirmedAt: dateOrNull(row.confirmed_at),
    failures: Number(row.failures),
    importerLocale: row.importer_locale === 'en' ? 'en' : 'ar',
    // Arabic while the database still requires an Arabic name (before 20261021090000: its row writer needs
    // the Arabic names; the worker deploys in parallel with the database).
    nameLanguage: row.name_language === 'ar' || row.english_only_names === false ? 'ar' : 'en',
    importerMayImport: row.importer_may_import === true,
    uploadAbandoned: row.upload_abandoned === true,
  };
}

/** Extends the lease by 15 minutes; false when it was lost. */
export async function renewUserImportLease(
  tx: ClaimsTx,
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    update platform.user_imports set lease_until = now() + interval '15 minutes'
    where id = ${id}::uuid and lease_token = ${leaseToken}::uuid returning id`);
  return rows.length > 0;
}

/**
 * Ends the lease. `retry`: the step failed for a reason worth another attempt — the next one waits
 * 2^failures minutes (at most an hour). `done`: the failure count starts again, and the import is due
 * again at once — or when the step said (the send clock's next slot, the next day of a capped
 * organization: private.user_import_release_next).
 */
export async function releaseUserImportLease(
  tx: ClaimsTx,
  id: string,
  leaseToken: string,
  outcome: 'done' | 'retry',
): Promise<number> {
  const [row] = await tx.execute<{ failures: number | string }>(sql`
    update platform.user_imports
    set lease_until = null, lease_token = null,
        failures = case when ${outcome} = 'retry' then least(failures + 1, 1000) else 0 end,
        next_attempt_at = case when ${outcome} = 'retry'
                               then now() + least(power(2, least(failures, 10)), 60) * interval '1 minute'
                               else greatest(now(), next_attempt_at) end
    where id = ${id}::uuid and lease_token = ${leaseToken}::uuid
    returning failures`);
  return Number(row?.failures ?? 0);
}

/**
 * A step outlived its lease (security review H1): counted as a failed attempt with the back-off, so the
 * import is not claimed again at once — unless another worker took a live lease meanwhile (then nothing
 * changes). Returns the failures now counted, or null when nothing changed.
 */
export async function noteUserImportLeaseLost(
  tx: ClaimsTx,
  id: string,
  leaseToken: string,
): Promise<number | null> {
  const [row] = await tx.execute<{ failures: number | string }>(sql`
    update platform.user_imports
    set lease_until = null, lease_token = null, failures = least(failures + 1, 1000),
        next_attempt_at = now() + least(power(2, least(failures, 10)), 60) * interval '1 minute'
    where id = ${id}::uuid
      and (lease_token = ${leaseToken}::uuid or lease_until is null or lease_until <= now())
    returning failures`);
  return row ? Number(row.failures) : null;
}

export interface StatusChange {
  readonly failureCode?: string | null;
  /** Why the run ended without its error report (IMPORTER_NOT_ALLOWED, REPORT_FAILED), or null. */
  readonly reportCode?: string | null;
  /** The undo's numbers (rows by undo result), kept with the result's numbers (`resultCounts.undo`). */
  readonly undoCounts?: Readonly<Record<string, number>>;
  readonly sheets?: readonly Record<string, unknown>[];
  readonly rowsTotal?: number;
  readonly reviewCounts?: Readonly<Record<string, unknown>>;
  readonly resultCounts?: Readonly<Record<string, unknown>>;
  readonly reviewFileId?: string | null;
  readonly reportFileId?: string | null;
  readonly checkpoint?: number;
}

/** Moves the import from one of `from` to `to` with the given values; false when it was elsewhere. */
export async function setUserImportStatus(
  tx: ClaimsTx,
  id: string,
  from: readonly UserImportStatus[],
  to: UserImportStatus,
  change: StatusChange = {},
): Promise<boolean> {
  const sets = [sql`status = ${to}`];
  if (change.failureCode !== undefined) sets.push(sql`failure_code = ${change.failureCode}`);
  if (change.reportCode !== undefined) sets.push(sql`report_code = ${change.reportCode}`);
  if (change.undoCounts !== undefined) {
    sets.push(
      sql`result_counts = coalesce(result_counts, '{}'::jsonb) || jsonb_build_object('undo', ${JSON.stringify(change.undoCounts)}::jsonb)`,
    );
  }
  if (change.sheets !== undefined) sets.push(sql`sheets = ${JSON.stringify(change.sheets)}::jsonb`);
  if (change.rowsTotal !== undefined) sets.push(sql`rows_total = ${change.rowsTotal}`);
  if (change.reviewCounts !== undefined) {
    sets.push(sql`review_counts = ${JSON.stringify(change.reviewCounts)}::jsonb`);
  }
  if (change.resultCounts !== undefined) {
    sets.push(sql`result_counts = ${JSON.stringify(change.resultCounts)}::jsonb`);
  }
  if (change.reviewFileId !== undefined)
    sets.push(sql`review_file_id = ${change.reviewFileId}::uuid`);
  if (change.reportFileId !== undefined)
    sets.push(sql`report_file_id = ${change.reportFileId}::uuid`);
  if (change.checkpoint !== undefined) sets.push(sql`checkpoint = ${change.checkpoint}`);
  const rows = await tx.execute(sql`
    update platform.user_imports set ${sql.join(sets, sql`, `)}
    where id = ${id}::uuid and status in ${sql`(${sql.join(
      from.map((s) => sql`${s}`),
      sql`, `,
    )})`}
    returning id`);
  return rows.length > 0;
}

export interface StagedColumn {
  readonly sheetIndex: number;
  readonly index: number;
  readonly header: string;
  readonly samples: readonly string[];
}

/** Stores the columns of the file's sheets (header, up to 3 samples). */
export async function saveUserImportColumns(
  tx: ClaimsTx,
  id: string,
  columns: readonly StagedColumn[],
): Promise<void> {
  for (let at = 0; at < columns.length; at += 500) {
    const slice = columns.slice(at, at + 500).map((c) => ({
      s: c.sheetIndex,
      c: c.index,
      h: c.header,
      v: c.samples,
    }));
    await tx.execute(sql`
      insert into platform.user_import_columns (import_id, sheet_index, column_index, header, samples)
      select ${id}::uuid, x.s, x.c, x.h, array(select jsonb_array_elements_text(x.v))
      from jsonb_to_recordset(${JSON.stringify(slice)}::jsonb) as x(s smallint, c smallint, h text, v jsonb)
      on conflict do nothing`);
  }
}

export interface StagedRow {
  readonly rowNumber: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly formatIssues: readonly unknown[];
}

/** Stages rows (one statement per call; callers pass batches of 500). */
export async function stageUserImportRows(
  tx: ClaimsTx,
  id: string,
  rows: readonly StagedRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({ n: r.rowNumber, c: r.cells, d: r.data, f: r.formatIssues }));
  await tx.execute(sql`
    insert into platform.user_import_rows (import_id, row_number, cells, data, format_issues, issues)
    select ${id}::uuid, x.n, x.c, x.d, x.f, x.f
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(n integer, c jsonb, d jsonb, f jsonb)`);
}

/** Removes the staged rows (a new dry run), or the rows and the columns (the data is purged). */
export async function deleteUserImportStaged(
  tx: ClaimsTx,
  id: string,
  what: 'rows' | 'all',
): Promise<void> {
  await tx.execute(sql`delete from platform.user_import_rows where import_id = ${id}::uuid`);
  if (what === 'all') {
    await tx.execute(sql`delete from platform.user_import_columns where import_id = ${id}::uuid`);
  }
}

/** The staged columns' headers of one sheet, by column index. */
export async function loadUserImportHeaders(
  tx: ClaimsTx,
  id: string,
  sheetIndex: number,
): Promise<Map<number, string>> {
  const rows = await tx.execute<{ column_index: number | string; header: string }>(sql`
    select column_index, header from platform.user_import_columns
    where import_id = ${id}::uuid and sheet_index = ${sheetIndex}`);
  return new Map(rows.map((r) => [Number(r.column_index), r.header]));
}

/** The dry run (private.user_import_classify) and its numbers. */
export async function classifyUserImport(
  tx: ClaimsTx,
  id: string,
): Promise<Record<string, unknown>> {
  await tx.execute(sql`select private.user_import_classify(${id}::uuid)`);
  return userImportReviewCounts(tx, id);
}

export async function userImportReviewCounts(
  tx: ClaimsTx,
  id: string,
): Promise<Record<string, unknown>> {
  const [row] = await tx.execute<{ counts: Record<string, unknown> }>(
    sql`select private.user_import_review_counts(${id}::uuid) as counts`,
  );
  return row?.counts ?? {};
}

/** The fresh check at the start of the run: rows that changed since the review become errors. */
export async function recheckUserImport(tx: ClaimsTx, id: string): Promise<number> {
  const [row] = await tx.execute<{ changed: number | string }>(
    sql`select private.user_import_recheck(${id}::uuid) as changed`,
  );
  return Number(row?.changed ?? 0);
}

/** The importer may no longer import (JU001): the run stops. */
export const IMPORTER_NOT_ALLOWED = 'IMPORTER_NOT_ALLOWED';

/** One batch of the run; returns the rows processed (0: done). Throws DomainError IMPORTER_NOT_ALLOWED. */
export async function applyUserImportBatch(
  tx: ClaimsTx,
  id: string,
  limit: number,
): Promise<number> {
  try {
    const [row] = await tx.execute<{ done: number | string }>(
      sql`select private.user_import_apply_batch(${id}::uuid, ${limit}) as done`,
    );
    return Number(row?.done ?? 0);
  } catch (error) {
    if (pgError(error)?.code === 'JU001')
      throw new DomainError(IMPORTER_NOT_ALLOWED, { cause: error });
    throw error;
  }
}

/** The result of every row not written, then the result's numbers. */
export async function finishUserImportRows(
  tx: ClaimsTx,
  id: string,
): Promise<Record<string, unknown>> {
  await tx.execute(sql`select private.user_import_finish_rows(${id}::uuid)`);
  const [row] = await tx.execute<{ counts: Record<string, unknown> }>(
    sql`select private.user_import_result_counts(${id}::uuid) as counts`,
  );
  return row?.counts ?? {};
}

/**
 * Schedules the import's held invitations at the pace (the import is in `inviting`). Throws DomainError
 * IMPORTER_NOT_ALLOWED when the importer may no longer invite (the invitation guard refuses: 42501).
 */
export async function scheduleUserImportInvitations(
  tx: ClaimsTx,
  id: string,
  paceSeconds: number,
): Promise<number> {
  try {
    const [row] = await tx.execute<{ scheduled: number | string }>(sql`
      select private.schedule_held_invitations(
        array(select v.id from platform.invitations v
              where v.import_id = ${id}::uuid and v.status = 'pending' and v.mail_held and v.send_at is null),
        make_interval(secs => ${paceSeconds})) as scheduled`);
    return Number(row?.scheduled ?? 0);
  } catch (error) {
    if (pgError(error)?.code === '42501')
      throw new DomainError(IMPORTER_NOT_ALLOWED, { cause: error });
    throw error;
  }
}

/** The worker's settings for sending import invitations (security review M2). */
export interface InvitationSending {
  /** Platform-wide pace: milliseconds between two import invitations (100–60,000). */
  readonly intervalMs: number;
  /** Import invitations an organization in service may send per day (UTC). */
  readonly dailyCap: number;
  /** The same for an organization on trial (lower). */
  readonly trialDailyCap: number;
}

export type ReleaseState = 'released' | 'wait' | 'capped' | 'none' | 'not_allowed';

const RELEASE_STATES: readonly ReleaseState[] = [
  'released',
  'wait',
  'capped',
  'none',
  'not_allowed',
];

/**
 * Sends the next due held invitation of the import, one per call (private.user_import_release_next):
 * `released`; `wait` until notBefore (the platform-wide send clock); `capped` until notBefore (the
 * organization's daily number reached — the next day); `none` due; `not_allowed` (the importer may no
 * longer invite: the schedule is cleared). The import's next attempt is moved to notBefore.
 */
export async function releaseNextUserImportInvitation(
  tx: ClaimsTx,
  id: string,
  sending: InvitationSending,
): Promise<{ readonly state: ReleaseState; readonly notBefore: Date | null }> {
  const [row] = await tx.execute<{ state: string; not_before: unknown }>(sql`
    select state, not_before from private.user_import_release_next(
      ${id}::uuid, make_interval(secs => ${sending.intervalMs / 1000}), ${sending.dailyCap}, ${sending.trialDailyCap})`);
  const state = RELEASE_STATES.find((s) => s === row?.state) ?? 'none';
  return { state, notBefore: dateOrNull(row?.not_before) };
}

/**
 * One batch of an undo; returns the rows processed (0: done), or -1 when the member who asked for the
 * undo may no longer undo it (security review L1: nothing changed; the worker ends the undo).
 */
export async function undoUserImportBatch(
  tx: ClaimsTx,
  id: string,
  limit: number,
): Promise<number> {
  const [row] = await tx.execute<{ done: number | string }>(
    sql`select private.user_import_undo_batch(${id}::uuid, ${limit}) as done`,
  );
  return Number(row?.done ?? 0);
}

/** The undo's numbers (rows by undo result). */
export async function userImportUndoCounts(
  tx: ClaimsTx,
  id: string,
): Promise<Record<string, number>> {
  const rows = await tx.execute<{ undo_result: string; n: number | string }>(sql`
    select undo_result, count(*) as n from platform.user_import_rows
    where import_id = ${id}::uuid and undo_result is not null group by undo_result`);
  return Object.fromEntries(rows.map((r) => [r.undo_result, Number(r.n)]));
}

export interface ReportSourceRow {
  readonly rowNumber: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly kind: string | null;
  readonly result: string | null;
  readonly issues: unknown;
  readonly resultIssues: unknown;
}

/**
 * Rows for the review's list of problems (`review`: errors, skipped rows and rows with warnings) or the
 * error report (`result`: rows not imported, skipped, or imported with warnings), after `afterRow`.
 */
export async function loadUserImportReportRows(
  tx: ClaimsTx,
  id: string,
  phase: 'review' | 'result',
  afterRow: number,
  limit: number,
): Promise<ReportSourceRow[]> {
  const which =
    phase === 'review'
      ? sql`(r.review_kind in ('error', 'skip') or (r.review_kind in ('new', 'existing') and r.issues @> '[{"s": "w"}]'))`
      : sql`(r.result in ('failed', 'not_processed', 'skipped')
             or (r.result in ('added', 'updated') and r.result_issues @> '[{"s": "w"}]'))`;
  const rows = await tx.execute(sql`
    select r.row_number, r.cells, r.review_kind, r.result, r.issues, r.result_issues
    from platform.user_import_rows r
    where r.import_id = ${id}::uuid and r.row_number > ${afterRow} and ${which}
    order by r.row_number limit ${limit}`);
  return rows.map((r) => ({
    rowNumber: Number(r.row_number),
    cells: (r.cells as Record<string, string> | null) ?? {},
    kind: (r.review_kind as string | null) ?? null,
    result: (r.result as string | null) ?? null,
    issues: r.issues,
    resultIssues: r.result_issues,
  }));
}

/** Marks the import's data deleted (columns and rows removed first; the files by their own service). */
export async function markUserImportPurged(tx: ClaimsTx, id: string): Promise<void> {
  await deleteUserImportStaged(tx, id, 'all');
  await tx.execute(sql`
    update platform.user_imports set data_purged_at = now()
    where id = ${id}::uuid and data_purged_at is null`);
}

/**
 * Held invitations of the import that were scheduled but not sent stay held (a stopped or failed run:
 * «لم تُرسل الدعوة»; they can be sent from the users list).
 */
export async function clearUserImportSchedule(tx: ClaimsTx, id: string): Promise<number> {
  const rows = await tx.execute(sql`
    update platform.invitations set send_at = null
    where import_id = ${id}::uuid and mail_held and send_at is not null and status = 'pending'
    returning id`);
  return rows.length;
}

/** A file's status as a job of its tenant sees it (null once purged or not visible). */
export async function jobFileStatus(tx: ClaimsTx, fileId: string): Promise<string | null> {
  const [row] = await tx.execute<{ status: string }>(
    sql`select status from platform.files where id = ${fileId}::uuid and purged_at is null`,
  );
  return row?.status ?? null;
}
