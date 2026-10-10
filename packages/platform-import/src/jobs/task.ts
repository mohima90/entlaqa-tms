import { deleteFileRecord, isDomainError, markFileUsed } from '@jadarat/platform-db';
import {
  IMPORTER_NOT_ALLOWED,
  type SystemTx,
  type UserImportClaim,
  type UserImportJobView,
  type WithPlatformTx,
  type WithSystemTx,
  applyUserImportBatch,
  classifyUserImport,
  claimUserImportWork,
  clearUserImportSchedule,
  deleteUserImportStaged,
  finishUserImportRows,
  insertSystemAuditEvent,
  jobFileStatus,
  loadUserImportForJob,
  markUserImportPurged,
  recheckUserImport,
  releaseDueUserImportInvitations,
  releaseUserImportLease,
  saveUserImportColumns,
  scheduleUserImportInvitations,
  setUserImportStatus,
  stageUserImportRows,
  undoUserImportBatch,
  userImportUndoCounts,
} from '@jadarat/platform-db/jobs';
import { FileIntegrityError, type WorkerFiles, isTemporary } from '@jadarat/platform-files/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isSpreadsheetError, kindOfType, openSpreadsheet } from '../spreadsheet/index';
import { reportFileName } from '../users/report';
import { toImportMapping } from '../users/rows';
import { MAX_IMPORT_FILE_BYTES } from '../users/limits';
import { type ReadOutcome, readSheets, stagedBatches } from './read';
import { buildReport, reportColumns } from './report';

/**
 * The user import's worker task (T-M2-12, FR-IAM-04, NFR-PERF-05; ADR 0005 — a platform task: imports
 * of every organization). Each pass claims imports that need a step (private.claim_user_import_work,
 * leased 15 minutes) and does it in the import's tenant transactions, each one checking the lease:
 *
 *   read      the scanned file's sheets, columns and sample values (→ mapping, or rejected);
 *   validate  the chosen sheet's rows checked and staged, the dry run, the list of problems (→ review);
 *   run       queued → checking (the fresh check) → importing (batches of 500, each with its checkpoint:
 *             a restart continues after the last batch) → inviting (held invitations scheduled at the
 *             pace) → finished, with the error report; stopped after a batch when asked; failed when
 *             the importer may no longer import;
 *   send      held invitations whose time has come are released (the invitation mailer e-mails them);
 *   undo      batches of 500 (→ undone);
 *   expire    a review not confirmed in 24 hours (→ expired);
 *   purge     files and staged data deleted (7 days after the end; at once for refused, cancelled and
 *             expired imports). The import record stays with the audit log.
 *
 * A failed step is tried again after 2^n minutes (at most an hour); after MAX_FAILURES attempts the
 * import ends (failed: what was added stays, the rest is in the error report). Logs carry ids, codes and
 * counts only (TM-0004 T-PEO-20).
 */
export const USER_IMPORT_TASK = 'platform.user_imports';
/** Rows written per transaction (design README §9). */
export const USER_IMPORT_BATCH = 500;
/** Invitations released per transaction. */
export const SEND_BATCH = 100;
/** A pass hands over after this long (the next pass is queued at once). */
export const PASS_BUDGET_MS = 4 * 60_000;
/** Failed attempts of one step before the import ends. */
export const MAX_FAILURES = 6;
/** Default pace of an import's invitations: one a second (Resend's default API limit: 2 a second). */
export const DEFAULT_INVITATION_PACE_SECONDS = 1;

export interface UserImportTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly files: WorkerFiles;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Seconds between two invitations of an import (0–60). */
  readonly invitationPaceSeconds?: number;
  readonly now?: () => number;
}

/** Why a file the scan did not pass cannot be imported (screen 13's file states). */
export function fileRefusalCode(status: string | null, reason: string | null): string {
  if (status === 'infected') return 'FILE_INFECTED';
  if (status === 'rejected') {
    switch (reason) {
      case 'too_large':
        return 'FILE_TOO_LARGE';
      case 'empty':
        return 'FILE_EMPTY';
      case 'encrypted':
        return 'FILE_PROTECTED';
      case 'unscannable':
        return 'FILE_UNREADABLE';
      default:
        return 'FILE_TYPE';
    }
  }
  if (status === 'error') return 'FILE_SCAN_FAILED';
  if (status === 'clean') return 'FILE_TYPE';
  return 'FILE_DELETED';
}

/** The lease was taken over (another worker, or it ran out): this pass leaves the import alone. */
export class LeaseLost extends Error {
  override readonly name = 'LeaseLost';
}

type StepResult = 'done' | 'more';

/**
 * A stable code for the logs: the error's code (SQLSTATE, DomainError code) or a cause's — never a
 * message (PostgreSQL's quote values).
 */
export function codeOf(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[A-Za-z0-9_]{2,64}$/.test(code)) return code;
    current = cause;
  }
  return error instanceof Error ? error.name : 'unknown';
}

/** Numbers only, for the audit records. */
function numbersOf(counts: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value === 'number') out[key] = value;
    else if (typeof value === 'string' && /^\d+$/.test(value)) out[key] = Number(value);
  }
  return out;
}

export function createUserImportTask(options: UserImportTaskOptions): PlatformTask {
  const { withPlatformTx, withSystemTx, files, log } = options;
  const now = options.now ?? Date.now;
  const pace = Math.min(
    60,
    Math.max(0, options.invitationPaceSeconds ?? DEFAULT_INVITATION_PACE_SECONDS),
  );

  /** A tenant transaction of the import, while the lease holds. */
  function inImport<T>(
    jobId: string,
    claim: UserImportClaim,
    fn: (tx: SystemTx, view: UserImportJobView) => Promise<T>,
  ): Promise<T> {
    return withSystemTx({ tenantId: claim.tenantId, jobId }, async (tx) => {
      const view = await loadUserImportForJob(tx, claim.importId, claim.leaseToken);
      if (!view) throw new LeaseLost('the lease was lost');
      return fn(tx, view);
    });
  }

  async function audit(
    tx: SystemTx,
    action: string,
    importId: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await insertSystemAuditEvent(tx, {
      action,
      entityType: 'user_import',
      entityId: importId,
      data,
    });
  }

  /** Records the first use of a clean file (imports' files are kept 7 days from then). */
  async function markUsed(tx: SystemTx, fileId: string | null): Promise<void> {
    if (fileId !== null && (await jobFileStatus(tx, fileId)) === 'clean') {
      await markFileUsed(tx, fileId);
    }
  }

  /** The review's list of problems or the error report, stored for the importer; its id (none: null). */
  async function storeReport(
    tx: SystemTx,
    view: UserImportJobView,
    phase: 'review' | 'result',
  ): Promise<string | null> {
    if (view.sheetIndex === null || view.mapping === null) return null;
    const columns = await reportColumns(
      tx,
      view.id,
      view.sheetIndex,
      view.mapping,
      view.importerLocale,
    );
    const report = await buildReport(tx, view.id, phase, view.importerLocale, columns);
    if (report.rows === 0) return null;
    const fileId = await files.storeGeneratedFile(tx, {
      purpose: 'platform.user_import_report',
      owner: { module: 'platform', entityType: 'user_import', entityId: view.id },
      name: reportFileName(view.fileName, view.importerLocale, phase),
      type: 'text/csv',
      bytes: report.bytes,
      forUserId: view.createdBy,
    });
    // The error report is kept 7 days (PO decision 8); the review's list until the review ends.
    if (phase === 'result') await markFileUsed(tx, fileId);
    return fileId;
  }

  /** Ends a run: every row's result, the numbers, the error report, the audit record. */
  async function endRun(
    tx: SystemTx,
    view: UserImportJobView,
    to: 'finished' | 'stopped' | 'failed',
    failureCode: string | null = null,
  ): Promise<void> {
    // Not sent yet: they stay «لم تُرسل الدعوة» (design README §9, stop).
    if (to !== 'finished') await clearUserImportSchedule(tx, view.id);
    await markUsed(tx, view.fileId);
    const counts = await finishUserImportRows(tx, view.id);
    const reportFileId = await storeReport(tx, view, 'result');
    await setUserImportStatus(tx, view.id, [view.status], to, {
      resultCounts: counts,
      reportFileId,
      ...(failureCode === null ? {} : { failureCode }),
    });
    await audit(tx, `platform.user_import.${to}`, view.id, {
      counts: numbersOf(counts),
      ...(failureCode === null ? {} : { failureCode }),
    });
    log('info', `user import ${view.id}: ${to}`);
  }

  async function expire(jobId: string, claim: UserImportClaim): Promise<StepResult> {
    await inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'expire') return;
      await setUserImportStatus(
        tx,
        view.id,
        ['uploaded', 'mapping', 'validating', 'review'],
        'expired',
      );
      log('info', `user import ${view.id}: review expired`);
    });
    return 'done';
  }

  async function refuse(
    tx: SystemTx,
    view: UserImportJobView,
    code: string,
    extra = {},
  ): Promise<void> {
    await setUserImportStatus(tx, view.id, [view.status], 'rejected', {
      failureCode: code,
      ...extra,
    });
    log('info', `user import ${view.id}: file refused (${code})`);
  }

  async function read(jobId: string, claim: UserImportClaim): Promise<StepResult> {
    const opened = await inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'read') return null;
      const kind = kindOfType(view.fileType);
      if (view.fileStatus !== 'clean' || kind === null) {
        await refuse(tx, view, fileRefusalCode(view.fileStatus, view.fileStatusReason));
        return null;
      }
      return { kind, stream: await files.openScannedFile(tx, view.fileId) };
    });
    if (opened === null) return 'done';
    // Read outside any transaction (the file may take seconds); the result is written under the lease.
    let outcome: ReadOutcome;
    try {
      const file = await openSpreadsheet(opened.kind, opened.stream, {
        maxBytes: MAX_IMPORT_FILE_BYTES,
      });
      outcome = await readSheets(file);
    } catch (error) {
      if (!isSpreadsheetError(error) && !(error instanceof FileIntegrityError)) throw error;
      const code = isSpreadsheetError(error) ? error.code : 'FILE_UNREADABLE';
      await inImport(jobId, claim, (tx, view) =>
        view.step === 'read' ? refuse(tx, view, code) : Promise.resolve(),
      );
      return 'done';
    }
    await inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'read') return;
      const sheets = outcome.sheets.map((s) => ({ ...s }));
      if (outcome.kind === 'rejected') {
        await refuse(tx, view, outcome.code, { sheets });
        return;
      }
      await saveUserImportColumns(tx, view.id, outcome.columns);
      await setUserImportStatus(tx, view.id, ['uploaded'], 'mapping', { sheets });
      log('info', `user import ${view.id}: read (${String(sheets.length)} sheets)`);
    });
    return 'done';
  }

  async function validate(jobId: string, claim: UserImportClaim): Promise<StepResult> {
    // One transaction: the staged rows, the dry run and the review appear together, or not at all.
    await inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'validate' || view.sheetIndex === null || view.mapping === null) return;
      const kind = kindOfType(view.fileType);
      if (view.fileStatus !== 'clean' || kind === null) {
        await refuse(tx, view, fileRefusalCode(view.fileStatus, view.fileStatusReason));
        return;
      }
      await deleteUserImportStaged(tx, view.id, 'rows');
      let total = 0;
      try {
        const file = await openSpreadsheet(kind, await files.openScannedFile(tx, view.fileId), {
          maxBytes: MAX_IMPORT_FILE_BYTES,
        });
        for await (const batch of stagedBatches(
          file.rows(view.sheetIndex),
          toImportMapping(view.mapping),
        )) {
          await stageUserImportRows(tx, view.id, batch);
          total += batch.length;
        }
      } catch (error) {
        if (!isSpreadsheetError(error) && !(error instanceof FileIntegrityError)) throw error;
        await deleteUserImportStaged(tx, view.id, 'rows');
        await refuse(tx, view, isSpreadsheetError(error) ? error.code : 'FILE_UNREADABLE');
        return;
      }
      const counts = await classifyUserImport(tx, view.id);
      const reviewFileId = await storeReport(tx, view, 'review');
      await setUserImportStatus(tx, view.id, ['validating'], 'review', {
        rowsTotal: total,
        reviewCounts: counts,
        reviewFileId,
      });
      log('info', `user import ${view.id}: reviewed (${String(total)} rows)`);
    });
    return 'done';
  }

  /** One transaction of the run; 'again' when the run goes on. */
  function runOnce(jobId: string, claim: UserImportClaim): Promise<'again' | 'done'> {
    return inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'run') return 'done';
      if (view.stopRequested) {
        await endRun(tx, view, 'stopped');
        return 'done';
      }
      switch (view.status) {
        case 'queued':
          // The uploaded file's 7 days start now (retention class `import`).
          await markUsed(tx, view.fileId);
          await setUserImportStatus(tx, view.id, ['queued'], 'checking');
          return 'again';
        case 'checking': {
          const changed = await recheckUserImport(tx, view.id);
          await setUserImportStatus(tx, view.id, ['checking'], 'importing', { checkpoint: 0 });
          log('info', `user import ${view.id}: checked again (${String(changed)} rows changed)`);
          return 'again';
        }
        case 'importing': {
          if ((await applyUserImportBatch(tx, view.id, USER_IMPORT_BATCH)) > 0) return 'again';
          if (view.options?.invitations === 'send') {
            await setUserImportStatus(tx, view.id, ['importing'], 'inviting');
            return 'again';
          }
          await endRun(tx, view, 'finished');
          return 'done';
        }
        case 'inviting': {
          const scheduled = await scheduleUserImportInvitations(tx, view.id, pace);
          log('info', `user import ${view.id}: ${String(scheduled)} invitations scheduled`);
          await endRun(tx, view, 'finished');
          return 'done';
        }
        default:
          return 'done';
      }
    });
  }

  async function run(jobId: string, claim: UserImportClaim, deadline: number): Promise<StepResult> {
    for (;;) {
      let next: 'again' | 'done';
      try {
        next = await runOnce(jobId, claim);
      } catch (error) {
        if (!isDomainError(error, IMPORTER_NOT_ALLOWED)) throw error;
        // The importer was demoted, deactivated or removed: what was added stays; the rest is reported.
        await inImport(jobId, claim, (tx, view) =>
          view.step === 'run'
            ? endRun(tx, view, 'failed', 'IMPORTER_NOT_ALLOWED')
            : Promise.resolve(),
        );
        return 'done';
      }
      if (next === 'done') return 'done';
      if (now() > deadline) return 'more';
    }
  }

  async function send(
    jobId: string,
    claim: UserImportClaim,
    deadline: number,
  ): Promise<StepResult> {
    for (;;) {
      const released = await inImport(jobId, claim, (tx, view) =>
        view.step === 'send'
          ? releaseDueUserImportInvitations(tx, view.id, SEND_BATCH)
          : Promise.resolve(0),
      );
      if (released < 0) {
        log(
          'warning',
          `user import ${claim.importId}: the importer may no longer invite; invitations kept`,
        );
        return 'done';
      }
      if (released > 0) {
        log('info', `user import ${claim.importId}: ${String(released)} invitations sent`);
      }
      if (released < SEND_BATCH) return 'done';
      if (now() > deadline) return 'more';
    }
  }

  async function undo(
    jobId: string,
    claim: UserImportClaim,
    deadline: number,
  ): Promise<StepResult> {
    for (;;) {
      const finished = await inImport(jobId, claim, async (tx, view) => {
        if (view.step !== 'undo') return true;
        if ((await undoUserImportBatch(tx, view.id, USER_IMPORT_BATCH)) > 0) return false;
        const counts = await userImportUndoCounts(tx, view.id);
        await setUserImportStatus(tx, view.id, ['undoing'], 'undone');
        await audit(tx, 'platform.user_import.undone', view.id, { counts });
        log('info', `user import ${view.id}: undone`);
        return true;
      });
      if (finished) return 'done';
      if (now() > deadline) return 'more';
    }
  }

  async function purge(jobId: string, claim: UserImportClaim): Promise<StepResult> {
    await inImport(jobId, claim, async (tx, view) => {
      if (view.step !== 'purge') return;
      for (const fileId of [view.fileId, view.reviewFileId, view.reportFileId]) {
        if (fileId === null) continue;
        const status = await jobFileStatus(tx, fileId);
        // Infected files stay in quarantine (their own retention); scanning ones are left to retention.
        if (status !== null && !['infected', 'scanning', 'deleted'].includes(status)) {
          await deleteFileRecord(tx, fileId);
        }
      }
      await markUserImportPurged(tx, view.id);
      log('info', `user import ${view.id}: data deleted`);
    });
    return 'done';
  }

  /** After too many failed attempts: the import ends in the state its step allows. */
  async function giveUp(jobId: string, claim: UserImportClaim): Promise<void> {
    await inImport(jobId, claim, async (tx, view) => {
      if (view.step === 'run') {
        await endRun(tx, view, 'failed', 'SYSTEM_FAULT');
      } else if (view.step === 'read' || view.step === 'validate') {
        await setUserImportStatus(tx, view.id, [view.status], 'failed', {
          failureCode: 'SYSTEM_FAULT',
        });
        log('warning', `user import ${view.id}: failed (SYSTEM_FAULT)`);
      } else if (view.step === 'undo') {
        await setUserImportStatus(tx, view.id, ['undoing'], 'failed', {
          failureCode: 'UNDO_FAILED',
        });
        await audit(tx, 'platform.user_import.undo_failed', view.id, {
          counts: await userImportUndoCounts(tx, view.id),
        });
        log('warning', `user import ${view.id}: undo failed`);
      }
    });
  }

  function handle(jobId: string, claim: UserImportClaim, deadline: number): Promise<StepResult> {
    switch (claim.step) {
      case 'expire':
        return expire(jobId, claim);
      case 'read':
        return read(jobId, claim);
      case 'validate':
        return validate(jobId, claim);
      case 'run':
        return run(jobId, claim, deadline);
      case 'send':
        return send(jobId, claim, deadline);
      case 'undo':
        return undo(jobId, claim, deadline);
      case 'purge':
        return purge(jobId, claim);
    }
  }

  /** A failed step: tried again later, or — after MAX_FAILURES — the import ends. */
  async function failed(jobId: string, claim: UserImportClaim, error: unknown): Promise<void> {
    log(
      'warning',
      `user import ${claim.importId}: ${claim.step} failed (${codeOf(error)}${isTemporary(error) ? ', temporary' : ''})`,
    );
    let outcome: 'done' | 'retry' = 'retry';
    try {
      const failures = await withSystemTx({ tenantId: claim.tenantId, jobId }, async (tx) => {
        const view = await loadUserImportForJob(tx, claim.importId, claim.leaseToken);
        return view?.failures ?? 0;
      });
      if (failures + 1 >= MAX_FAILURES) {
        await giveUp(jobId, claim);
        outcome = 'done';
      }
    } catch (inner) {
      log('warning', `user import ${claim.importId}: could not end it (${codeOf(inner)})`);
    }
    // When even this fails, the lease runs out in 15 minutes and the step is tried again.
    await withSystemTx({ tenantId: claim.tenantId, jobId }, (tx) =>
      releaseUserImportLease(tx, claim.importId, claim.leaseToken, outcome),
    ).catch(() => undefined);
  }

  return {
    name: USER_IMPORT_TASK,
    async run({ jobId }) {
      const deadline = now() + PASS_BUDGET_MS;
      for (;;) {
        const claim = await withPlatformTx({ jobId }, claimUserImportWork);
        if (!claim) return false;
        let result: StepResult = 'done';
        try {
          result = await handle(jobId, claim, deadline);
          await withSystemTx({ tenantId: claim.tenantId, jobId }, (tx) =>
            releaseUserImportLease(tx, claim.importId, claim.leaseToken, 'done'),
          );
        } catch (error) {
          if (error instanceof LeaseLost) {
            log('warning', `user import ${claim.importId}: lease lost during ${claim.step}`);
          } else {
            await failed(jobId, claim, error);
          }
        }
        if (result === 'more' || now() > deadline) return true;
      }
    },
  };
}
