import type { StagedColumn, StagedRow } from '@jadarat/platform-db/jobs';
import {
  type OpenedSpreadsheet,
  type SheetRow,
  SpreadsheetError,
  summarizeSheet,
} from '../spreadsheet/index';
import { neverImportedReason } from '../users/headers';
import { MAX_IMPORT_ROWS } from '../users/limits';
import { type ImportMapping, normalizeRow } from '../users/rows';

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
 * Every sheet's header, size and samples. Refused (FILE_EMPTY, FILE_TOO_MANY_ROWS) when no sheet has
 * between 1 and `maxRows` data rows; sample values of columns that are never imported are not kept.
 */
export async function readSheets(
  file: OpenedSpreadsheet,
  maxRows: number = MAX_IMPORT_ROWS,
): Promise<ReadOutcome> {
  const sheets: SheetInfo[] = [];
  const columns: StagedColumn[] = [];
  for (let index = 0; index < file.sheets.length; index += 1) {
    const sheet = file.sheets[index];
    if (!sheet) continue;
    const summary = await summarizeSheet(file.rows(index), sheet);
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
 * The chosen sheet's data rows (the first row with text is the header), checked under the mapping, in
 * batches. Throws SpreadsheetError FILE_TOO_MANY_ROWS past `maxRows` and FILE_EMPTY without data rows.
 */
export async function* stagedBatches(
  rows: AsyncIterable<SheetRow> | Iterable<SheetRow>,
  mapping: ImportMapping,
  maxRows: number = MAX_IMPORT_ROWS,
): AsyncGenerator<StagedRow[]> {
  let header = true;
  let count = 0;
  let batch: StagedRow[] = [];
  for await (const row of rows) {
    if (header) {
      header = false;
      continue;
    }
    count += 1;
    if (count > maxRows) throw new SpreadsheetError('FILE_TOO_MANY_ROWS');
    const normalized = normalizeRow(row.number, row.cells, mapping);
    batch.push({
      rowNumber: normalized.rowNumber,
      cells: normalized.cells,
      data: normalized.data,
      formatIssues: normalized.issues,
    });
    if (batch.length === STAGE_BATCH) {
      yield batch;
      batch = [];
    }
  }
  if (count === 0) throw new SpreadsheetError('FILE_EMPTY');
  if (batch.length > 0) yield batch;
}
