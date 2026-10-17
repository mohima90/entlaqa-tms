import type { StagedColumn, StagedRow } from '@jadarat/platform-db/jobs';
import {
  type OpenedSpreadsheet,
  type SheetRow,
  SpreadsheetError,
  summarizeSheet,
} from '../spreadsheet/index';
import { neverImportedReason } from '../users/headers';
import { MAX_IMPORT_ROWS } from '../users/limits';
import type { NameLanguage } from '../users/fields';
import { type ImportMapping, type StoredNames, normalizeRow } from '../users/rows';

/**
 * Reading an import file in the worker (T-M2-12): the sheets with their columns for the mapping step
 * (`read`), then the chosen sheet's rows checked and staged for the dry run (`validate`). File content
 * goes to the import's own tables only; logs get codes and counts.
 */
export interface SheetInfo {
  readonly name: string;
  readonly rows: number;
  readonly columns: number;
  readonly hidden: boolean;
  readonly headerRow: number | null;
}

export type ReadOutcome =
  | { readonly kind: 'ready'; readonly sheets: SheetInfo[]; readonly columns: StagedColumn[] }
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly sheets: SheetInfo[];
    };

export { MAX_IMPORT_ROWS };

/**
 * Bounds for reading a file in a worker step (security review H1): a time budget (past it the file is
 * refused as unreadable) and a heartbeat that renews the import's lease every HEARTBEAT_ROWS rows.
 */
export interface ReadGuard {
  /** Epoch milliseconds after which the step gives up (FILE_UNREADABLE). */
  readonly deadline?: number;
  /** Called every HEARTBEAT_ROWS rows; throws to stop (e.g. the lease was lost). */
  readonly heartbeat?: () => Promise<void>;
  readonly now?: () => number;
}

export const HEARTBEAT_ROWS = 1000;

/** The rows, checked against the guard as they go. */
async function* guarded(rows: AsyncIterable<SheetRow>, guard: ReadGuard): AsyncGenerator<SheetRow> {
  const now = guard.now ?? Date.now;
  let count = 0;
  for await (const row of rows) {
    count += 1;
    if (count % HEARTBEAT_ROWS === 0) {
      if (guard.deadline !== undefined && now() > guard.deadline) {
        throw new SpreadsheetError('FILE_UNREADABLE');
      }
      await guard.heartbeat?.();
    }
    yield row;
  }
}

/**
 * Every sheet's header, size and samples. Refused (FILE_EMPTY, FILE_TOO_MANY_ROWS) when no sheet has
 * between 1 and `maxRows` data rows; sample values of columns that are never imported are not kept.
 */
export async function readSheets(
  file: OpenedSpreadsheet,
  maxRows: number = MAX_IMPORT_ROWS,
  guard: ReadGuard = {},
): Promise<ReadOutcome> {
  const sheets: SheetInfo[] = [];
  const columns: StagedColumn[] = [];
  for (let index = 0; index < file.sheets.length; index += 1) {
    const sheet = file.sheets[index];
    if (!sheet) continue;
    const summary = await summarizeSheet(guarded(file.rows(index), guard), sheet, { maxRows });
    sheets.push({
      name: summary.name,
      rows: summary.rows,
      columns: summary.columns,
      hidden: summary.hidden,
      headerRow: summary.headerRow,
    });
    for (let c = 0; c < summary.columns; c += 1) {
      const header = summary.header[c] ?? '';
      columns.push({
        sheetIndex: index,
        index: c,
        header,
        samples: neverImportedReason(header) === null ? (summary.samples[c] ?? []) : [],
      });
    }
  }
  if (!sheets.some((s) => s.rows >= 1 && s.rows <= maxRows)) {
    const tooMany = sheets.some((s) => s.rows > maxRows);
    return { kind: 'rejected', code: tooMany ? 'FILE_TOO_MANY_ROWS' : 'FILE_EMPTY', sheets };
  }
  return { kind: 'ready', sheets, columns };
}

/** Rows staged at a time (one statement, one batch of the dry run). */
export const STAGE_BATCH = 500;

/**
 * The names of the organization's active members with these e-mails (lower case), for the rows that update
 * them: their names are required only when the row changes one (normalizeRow `stored`).
 */
export type StoredNamesLookup = (
  emails: readonly string[],
) => Promise<ReadonlyMap<string, StoredNames>>;

const NAME_REQUIRED = new Set(['NAME_AR_REQUIRED', 'NAME_EN_REQUIRED']);

/**
 * The chosen sheet's data rows (the first row with text is the header), checked under the mapping, in
 * batches, the names of `nameLanguage` (the organization's default language) required — for a row of an
 * existing member (`storedNames`, asked once per batch for the rows missing a required name) only when it
 * changes a name. Throws SpreadsheetError FILE_TOO_MANY_ROWS past `maxRows` and FILE_EMPTY without data rows.
 */
export async function* stagedBatches(
  rows: AsyncIterable<SheetRow>,
  mapping: ImportMapping,
  nameLanguage: NameLanguage,
  maxRows: number = MAX_IMPORT_ROWS,
  guard: ReadGuard = {},
  storedNames?: StoredNamesLookup,
): AsyncGenerator<StagedRow[]> {
  let header = true;
  let count = 0;
  let batch: { readonly cells: readonly string[]; normalized: ReturnType<typeof normalizeRow> }[] =
    [];
  const finish = async (): Promise<StagedRow[]> => {
    const missing = batch.filter(
      (r) =>
        typeof r.normalized.data.email === 'string' &&
        r.normalized.issues.some((i) => NAME_REQUIRED.has(i.c)),
    );
    if (storedNames && missing.length > 0) {
      const found = await storedNames(missing.map((r) => r.normalized.data.email as string));
      for (const r of missing) {
        const stored = found.get(r.normalized.data.email as string);
        if (stored) {
          r.normalized = normalizeRow(
            r.normalized.rowNumber,
            r.cells,
            mapping,
            nameLanguage,
            stored,
          );
        }
      }
    }
    return batch.map(({ normalized }) => ({
      rowNumber: normalized.rowNumber,
      cells: normalized.cells,
      data: normalized.data,
      formatIssues: normalized.issues,
    }));
  };
  for await (const row of guarded(rows, guard)) {
    if (header) {
      header = false;
      continue;
    }
    count += 1;
    if (count > maxRows) throw new SpreadsheetError('FILE_TOO_MANY_ROWS');
    batch.push({
      cells: row.cells,
      normalized: normalizeRow(row.number, row.cells, mapping, nameLanguage),
    });
    if (batch.length === STAGE_BATCH) {
      yield await finish();
      batch = [];
    }
  }
  if (count === 0) throw new SpreadsheetError('FILE_EMPTY');
  if (batch.length > 0) yield await finish();
}
