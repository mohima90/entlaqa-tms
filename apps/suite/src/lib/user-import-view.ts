/**
 * The user import screens (T-M2-12; approved screens docs/design/screens/m2-user-import/) — server-side
 * view helpers: which step and state a page shows, the options in the URL, counts by code, deadlines.
 */
import { IMPORTABLE_ROLES } from '@jadarat/platform-import';

/**
 * The steps of an import. Redesign package 3: the options moved into the confirmation, next to the counts
 * they change (5 → 4 steps; same choices, same checks).
 */
export type ImportStep = 'file' | 'mapping' | 'review' | 'confirm';
export const IMPORT_STEPS: readonly ImportStep[] = ['file', 'mapping', 'review', 'confirm'];

const RUNNING = ['queued', 'checking', 'importing', 'inviting'] as const;
export type RunningStatus = (typeof RUNNING)[number];

export function isRunning(status: string): status is RunningStatus {
  return (RUNNING as readonly string[]).includes(status);
}

/** Before the run (the importer's steps). */
export function isDraft(status: string): boolean {
  return ['uploaded', 'mapping', 'validating', 'review'].includes(status);
}

/**
 * The step a draft import shows: by its status, and — in review — the step the URL asks for (an older
 * `?step=options` link opens the confirmation, where the options are now).
 */
export function draftStep(status: string, requested: string | undefined): ImportStep {
  if (status === 'uploaded' || status === 'rejected') return 'file';
  if (status === 'mapping') return 'mapping';
  if (status === 'validating') return 'review';
  if (requested === 'mapping' || requested === 'confirm') return requested;
  if (requested === 'options') return 'confirm';
  return 'review';
}

/**
 * Seconds between two status reads while the page waits for the worker (null: none). A cut upload — the
 * file never arrived (`pending_upload`) — waits for nobody: no polling (integration review L1).
 */
export function refreshSeconds(status: string, fileStatus: string | null = null): number | null {
  if (status === 'uploaded' && fileStatus === 'pending_upload') return null;
  if (status === 'uploaded' || status === 'validating') return 2;
  if (isRunning(status) || status === 'undoing') return 3;
  return null;
}

export interface ImportOptionsParams {
  readonly existing: 'skip' | 'upsert' | 'update_only';
  readonly defaultRole: string;
  readonly invitations: 'send' | 'hold';
}

const ROLE_CODES: ReadonlySet<string> = new Set(IMPORTABLE_ROLES.map((r) => r.code));

/** The options of step 4 from the URL (step 5 is a page of its own), or null when one is missing. */
export function optionsFromParams(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): ImportOptionsParams | null {
  const one = (key: string) => {
    const raw = params[key];
    return Array.isArray(raw) ? (raw[0] as string | undefined) : (raw as string | undefined);
  };
  const existing = one('existing');
  const defaultRole = one('defaultRole');
  const invitations = one('invitations');
  if (existing !== 'skip' && existing !== 'upsert' && existing !== 'update_only') return null;
  if (invitations !== 'send' && invitations !== 'hold') return null;
  if (defaultRole === undefined || !ROLE_CODES.has(defaultRole)) return null;
  return { existing, defaultRole, invitations };
}

export function optionsQuery(options: ImportOptionsParams): string {
  return new URLSearchParams({
    existing: options.existing,
    defaultRole: options.defaultRole,
    invitations: options.invitations,
  }).toString();
}

/** A count from the import's JSON counts (absent or malformed: 0). */
export function count(counts: Readonly<Record<string, unknown>> | null, key: string): number {
  const value = Number(counts?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export interface UndoSummary {
  readonly removed: number;
  /** Accepted their invitation, or others depend on them. */
  readonly kept: number;
  readonly restored: number;
  /** Their record changed after the import: kept as it is. */
  readonly changed: number;
  /** Hold a privileged role now and the undo was not an Organization Admin's (security review L1). */
  readonly privileged: number;
  /** Could not be undone (a fault). */
  readonly errors: number;
}

/** What an undo did (`resultCounts.undo`: rows by undo result), or null before any undo. */
export function undoSummary(counts: Readonly<Record<string, unknown>> | null): UndoSummary | null {
  const raw = counts?.undo;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const undo = raw as Readonly<Record<string, unknown>>;
  return {
    removed: count(undo, 'removed'),
    kept: count(undo, 'kept_accepted') + count(undo, 'kept_referenced'),
    restored: count(undo, 'restored'),
    changed: count(undo, 'kept_changed'),
    privileged: count(undo, 'kept_privileged'),
    errors: count(undo, 'kept_error'),
  };
}

/** `{code: rows}` of the counts, largest first. */
export function codeCounts(
  counts: Readonly<Record<string, unknown>> | null,
  key: string,
): { readonly code: string; readonly rows: number }[] {
  const raw = counts?.[key];
  if (typeof raw !== 'object' || raw === null) return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([code, rows]) => ({ code, rows: Number(rows) }))
    .filter((entry) => /^[A-Z][A-Z0-9_]{1,63}$/.test(entry.code) && entry.rows > 0)
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Until when an import can be undone (7 days after it ended), or null. */
export function undoDeadline(finishedAt: Date | null): Date | null {
  return finishedAt === null ? null : new Date(finishedAt.getTime() + 7 * DAY_MS);
}

/**
 * May the signed-in member undo it now (PO decision 10)? Its importer, or an Organization Admin for any
 * import of the organization (`mayUndo` from the database; Tech Lead decision 10 Oct 2026).
 */
export function mayUndo(
  record: {
    readonly status: string;
    readonly mayUndo: boolean;
    readonly confirmedAt: Date | null;
    readonly finishedAt: Date | null;
    readonly dataPurgedAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  const deadline = undoDeadline(record.finishedAt);
  return (
    record.mayUndo &&
    ['finished', 'stopped', 'failed'].includes(record.status) &&
    record.confirmedAt !== null &&
    record.dataPurgedAt === null &&
    deadline !== null &&
    deadline > now
  );
}

/** The number of data rows the refused file had (the largest sheet), for FILE_TOO_MANY_ROWS. */
export function largestSheet(sheets: readonly { readonly rows: number }[]): number {
  return sheets.reduce((max, sheet) => Math.max(max, sheet.rows), 0);
}

/** Megabytes with one decimal (file sizes on step 1). */
export function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** The phase a running import is in, for the progress screen. */
export function runningPhase(status: string): 'checking' | 'importing' | 'inviting' {
  if (status === 'inviting') return 'inviting';
  if (status === 'importing') return 'importing';
  return 'checking';
}

/** Content-Disposition for a download with a non-ASCII name (RFC 6266 / RFC 5987). */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A name inside a translated sentence (file, sheet or person), isolated from the sentence's direction
 * with FSI … PDI — the plain-text form of <bdi> — so «الملف: لقطات.csv» does not show as «csv.لقطات».
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}
