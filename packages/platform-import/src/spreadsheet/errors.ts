/**
 * Why a file cannot be read (T-M2-12; approved screen 13 «حالات»: encoding, empty, rows, protected, …).
 * The code is stored on the import (`failure_code`) and shown with a message; it never carries file data.
 */
export type SpreadsheetErrorCode =
  /** Not UTF-8 (CSV), e.g. saved as Windows-1256 or UTF-16 (TM-0004 T-PEO-09). */
  | 'FILE_ENCODING'
  /** No header row, or a header row only. */
  | 'FILE_EMPTY'
  /** More data rows than the limit (10,000 per file). */
  | 'FILE_TOO_MANY_ROWS'
  /** More columns than the limit (200). */
  | 'FILE_TOO_MANY_COLUMNS'
  /** Password-protected or encrypted. */
  | 'FILE_PROTECTED'
  /** A macro-enabled workbook (.xlsm), or one carrying a VBA project. */
  | 'FILE_MACROS'
  /** Not a readable CSV or XLSX file (broken, truncated, unsupported ZIP features, bombs). */
  | 'FILE_UNREADABLE'
  /** More sheets than the limit (50). */
  | 'FILE_TOO_MANY_SHEETS';

export class SpreadsheetError extends Error {
  override readonly name = 'SpreadsheetError';
  constructor(
    readonly code: SpreadsheetErrorCode,
    /** Numbers only (e.g. the row count), never file content. */
    readonly params: Readonly<Record<string, number>> = {},
  ) {
    super(code);
  }
}

export function isSpreadsheetError(error: unknown): error is SpreadsheetError {
  return error instanceof SpreadsheetError;
}

/** The limits of a read (defaults: the import's limits, PO decision 9 Oct 2026). */
export interface ReadLimits {
  /** Data rows (the header excluded) a sheet may hold. */
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Characters a single cell may hold (Excel's own limit: 32,767). */
  readonly maxCellChars: number;
  /**
   * XLSX: bytes all the parts read in one step (one opening of the file) may inflate to together
   * (security review H1).
   */
  readonly maxUnpackedBytes: number;
}

export const DEFAULT_LIMITS: ReadLimits = {
  maxRows: 10_000,
  maxColumns: 200,
  maxCellChars: 32_767,
  maxUnpackedBytes: 256 * 1024 * 1024,
};

/**
 * One row as read: its number in the spreadsheet (as Excel shows it; CSV: the record's position) and
 * the text of its cells by column (index 0 = column A). Rows without any text are not returned.
 */
export interface SheetRow {
  readonly number: number;
  readonly cells: readonly string[];
}
