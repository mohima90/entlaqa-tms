import { readCsvRows } from './csv';
import { DEFAULT_LIMITS, type ReadLimits, type SheetRow, SpreadsheetError } from './errors';
import { XlsxWorkbook } from './xlsx';
import { looksLikeZip } from './zip';

/**
 * Reading the files of a user import (T-M2-12): a CSV file as a stream, an XLSX workbook from memory;
 * both give their rows as text. The first row with text is the header; the rows after it are data.
 */
export {
  DEFAULT_LIMITS,
  type ReadLimits,
  type SheetRow,
  SpreadsheetError,
  type SpreadsheetErrorCode,
  isSpreadsheetError,
} from './errors';
export {
  CSV_BOM,
  csvCell,
  csvLine,
  detectDelimiter,
  neutralizeFormula,
  readCsvRows,
  unneutralizeFormula,
} from './csv';
export { MAX_SHEETS, XlsxWorkbook, type XlsxSheet, isDateFormat, serialToIsoDate } from './xlsx';
export {
  type ColumnFormat,
  type WriterColumn,
  type WriterSheet,
  type WriterValidation,
  columnLetters,
  sheetReference,
  writeXlsx,
  xmlText,
} from './xlsx-writer';

export const CSV_TYPE = 'text/csv';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type SpreadsheetKind = 'csv' | 'xlsx';

/** The kind of a scanned file by the type its content showed, or null (not an import file). */
export function kindOfType(detectedType: string | null): SpreadsheetKind | null {
  if (detectedType === CSV_TYPE) return 'csv';
  if (detectedType === XLSX_TYPE) return 'xlsx';
  return null;
}

/** The whole stream in memory, refusing more than `maxBytes` (XLSX files: at most 20 MB). */
export async function readAll(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > maxBytes) throw new SpreadsheetError('FILE_UNREADABLE');
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** What the mapping step shows of a sheet (no file data beyond the header and a few samples). */
export interface SheetSummary {
  readonly name: string;
  readonly hidden: boolean;
  /** The header's row number, or null when the sheet has no text at all. */
  readonly headerRow: number | null;
  readonly header: readonly string[];
  /** Data rows (rows with text after the header); counted past the limit. */
  readonly rows: number;
  /** Columns that have a header or a value. */
  readonly columns: number;
  /** Per column: the first non-empty values (at most `samples`), each cut to 100 characters. */
  readonly samples: readonly (readonly string[])[];
}

/** Rows counted at most (Excel's last row): beyond, a file is refused anyway. */
const COUNT_LIMIT = 1_048_576;
const SAMPLE_CHARS = 100;

export async function summarizeSheet(
  rows: AsyncIterable<SheetRow> | Iterable<SheetRow>,
  sheet: { readonly name: string; readonly hidden: boolean },
  options: { readonly samples?: number } = {},
): Promise<SheetSummary> {
  const sampleCount = options.samples ?? 3;
  let headerRow: number | null = null;
  let header: readonly string[] = [];
  let count = 0;
  let columns = 0;
  const samples: string[][] = [];
  for await (const row of rows) {
    if (headerRow === null) {
      headerRow = row.number;
      header = row.cells.map((cell) => cell.trim().slice(0, 300));
      columns = header.length;
      continue;
    }
    count += 1;
    if (count > COUNT_LIMIT) break;
    if (row.cells.length > columns) columns = row.cells.length;
    row.cells.forEach((cell, index) => {
      const value = cell.trim();
      if (value === '') return;
      const list = (samples[index] ??= []);
      if (list.length < sampleCount) list.push(value.slice(0, SAMPLE_CHARS));
    });
  }
  const filled: string[][] = [];
  for (let i = 0; i < columns; i += 1) filled.push(samples[i] ?? []);
  return {
    name: sheet.name,
    hidden: sheet.hidden,
    headerRow,
    header,
    rows: count,
    columns,
    samples: filled,
  };
}

/** An import file opened for reading: its sheets and their rows. */
export interface OpenedSpreadsheet {
  readonly kind: SpreadsheetKind;
  readonly sheets: readonly { readonly name: string; readonly hidden: boolean }[];
  rows(sheetIndex: number): AsyncIterable<SheetRow> | Iterable<SheetRow>;
}

/**
 * Opens an import file. CSV: the stream is read once, so `rows(0)` may be called once. XLSX: the bytes
 * are read into memory (at most `maxBytes`), any sheet any number of times.
 */
export async function openSpreadsheet(
  kind: SpreadsheetKind,
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: { readonly maxBytes: number; readonly limits?: ReadLimits },
): Promise<OpenedSpreadsheet> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  if (kind === 'csv') {
    let used = false;
    return {
      kind,
      sheets: [{ name: '', hidden: false }],
      rows(sheetIndex) {
        if (sheetIndex !== 0 || used) throw new SpreadsheetError('FILE_UNREADABLE');
        used = true;
        return readCsvRows(source, limits);
      },
    };
  }
  const bytes = await readAll(source, options.maxBytes);
  if (!looksLikeZip(bytes)) throw new SpreadsheetError('FILE_UNREADABLE');
  const workbook = XlsxWorkbook.open(bytes, limits);
  return {
    kind,
    sheets: workbook.sheets.map((s) => ({ name: s.name, hidden: s.hidden })),
    rows: (sheetIndex) => workbook.rows(sheetIndex),
  };
}
