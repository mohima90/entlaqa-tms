import { DEFAULT_LIMITS, type ReadLimits, type SheetRow, SpreadsheetError } from './errors';

/**
 * CSV for the user import (T-M2-12): reading uploaded files (UTF-8 only, with or without BOM; comma or
 * semicolon separators, detected from the header line; RFC 4180 quoting) as a stream, and writing the
 * files we hand out (template, error report) so that spreadsheet programs never run a cell as a formula
 * (TM-0003 T-IAM-19, TM-0004 AB-PEO-04).
 */

/** Characters inside the header line we look at to choose the separator. */
const DETECTION_CHARS = 64 * 1024;

/** The separator the header line uses most: `;` when it has more semicolons than commas, else `,`. */
export function detectDelimiter(headerLine: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of headerLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** The CSV state machine: text in (any chunks), complete rows out. */
class CsvParser {
  private delimiter: ',' | ';' | null = null;
  private pending = '';
  private cells: string[] = [];
  private emptyBeyond = false;
  private field = '';
  private fieldStarted = false;
  private quoted = false;
  private quoteSeen = false;
  private afterCr = false;
  private rowNumber = 1;
  private readonly ready: SheetRow[] = [];

  constructor(private readonly limits: ReadLimits) {}

  /** Rows completed by this text (the separator is chosen from the header line first). */
  push(text: string): SheetRow[] {
    if (this.delimiter === null) {
      this.pending += text;
      const newline = this.pending.search(/[\r\n]/);
      if (newline === -1 && this.pending.length < DETECTION_CHARS) return [];
      this.delimiter = detectDelimiter(
        this.pending.slice(0, newline === -1 ? DETECTION_CHARS : newline),
      );
      text = this.pending;
      this.pending = '';
    }
    this.consume(text, this.delimiter);
    return this.ready.splice(0);
  }

  /** The last rows, at the end of the file. */
  end(): SheetRow[] {
    if (this.delimiter === null) {
      this.delimiter = detectDelimiter(this.pending);
      this.consume(this.pending, this.delimiter);
    }
    // A quote opened and never closed: the rest of the file would be one cell.
    if (this.quoted && !this.quoteSeen) throw new SpreadsheetError('FILE_UNREADABLE');
    if (this.fieldStarted || this.field !== '' || this.cells.length > 0 || this.emptyBeyond) {
      this.endRow();
    }
    return this.ready.splice(0);
  }

  private endField(): void {
    if (this.cells.length >= this.limits.maxColumns) {
      if (this.field.trim() !== '') throw new SpreadsheetError('FILE_TOO_MANY_COLUMNS');
      this.emptyBeyond = true;
    } else {
      this.cells.push(this.field);
    }
    this.field = '';
    this.fieldStarted = false;
    this.quoted = false;
    this.quoteSeen = false;
  }

  private endRow(): void {
    this.endField();
    if (!isBlank(this.cells)) {
      let last = this.cells.length;
      while (last > 0 && (this.cells[last - 1] ?? '').trim() === '') last -= 1;
      this.ready.push({ number: this.rowNumber, cells: this.cells.slice(0, last) });
    }
    this.rowNumber += 1;
    this.cells = [];
    this.emptyBeyond = false;
  }

  private append(text: string): void {
    this.field += text;
    if (this.field.length > this.limits.maxCellChars) throw new SpreadsheetError('FILE_UNREADABLE');
  }

  private consume(text: string, separator: ',' | ';'): void {
    let i = 0;
    while (i < text.length) {
      const char = text.charAt(i);
      if (this.afterCr) {
        this.afterCr = false;
        if (char === '\n') {
          i += 1;
          continue;
        }
      }
      if (this.quoted && !this.quoteSeen) {
        // Inside quotes: everything up to the next quote is text.
        const close = text.indexOf('"', i);
        if (close === -1) {
          this.append(text.slice(i));
          return;
        }
        this.append(text.slice(i, close));
        this.quoteSeen = true;
        i = close + 1;
        continue;
      }
      if (this.quoted && this.quoteSeen) {
        this.quoteSeen = false;
        if (char === '"') {
          this.append('"'); // an escaped quote
          i += 1;
          continue;
        }
        this.quoted = false; // the closing quote; what follows continues the cell as plain text
      }
      if (char === separator) {
        this.endField();
      } else if (char === '\n') {
        this.endRow();
      } else if (char === '\r') {
        this.endRow();
        this.afterCr = true;
      } else if (char === '"' && !this.fieldStarted) {
        this.quoted = true;
        this.fieldStarted = true;
      } else {
        this.fieldStarted = true;
        this.append(char);
      }
      i += 1;
    }
  }
}

/**
 * The rows of a CSV file, in order, as they are decoded — at most one row and one cell in memory. Cells
 * are the text as written (quotes removed); rows without any text are skipped (their number is not
 * reused). Throws SpreadsheetError FILE_ENCODING (not UTF-8), FILE_TOO_MANY_COLUMNS (a value beyond the
 * last allowed column) or FILE_UNREADABLE (a cell longer than the limit, e.g. a quote never closed).
 */
export async function* readCsvRows(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  limits: ReadLimits = DEFAULT_LIMITS,
): AsyncGenerator<SheetRow> {
  // fatal: invalid UTF-8 is an error, never U+FFFD; the BOM is removed by the decoder.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (chunk?: Uint8Array): string => {
    try {
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch {
      throw new SpreadsheetError('FILE_ENCODING');
    }
  };
  const parser = new CsvParser(limits);
  for await (const chunk of source) {
    yield* parser.push(decode(chunk));
  }
  yield* parser.push(decode());
  yield* parser.end();
}

/** UTF-8 byte order mark: spreadsheet programs then show Arabic correctly. */
export const CSV_BOM = '\uFEFF';

/**
 * Cells a spreadsheet program could run as a formula or command (CSV injection, OWASP): starting with
 * `=`, `+`, `-` or `@` (also after spaces, also their full-width forms), or with a tab or a carriage
 * return.
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;

/** The text as written to a file we hand out: formula-like cells get a leading `'` (shown as text). */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/**
 * The value of a cell read back from such a file: the `'` we added in front of formula-like text is
 * removed, so a corrected error report imports the values it was made from.
 */
export function unneutralizeFormula(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** One CSV cell: neutralized, quoted when it holds a separator, quote, line break or edge spaces. */
export function csvCell(value: string): string {
  const text = neutralizeFormula(value);
  return /[",;\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One CSV line (comma-separated, CRLF). */
export function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
