import { DEFAULT_LIMITS, type ReadLimits, type SheetRow, SpreadsheetError } from './errors';
import { attribute, parseXml, parseXmlAsync, XmlStream, YIELD_BYTES, yieldToLoop } from './xml';
import { ZipArchive, normalizeName } from './zip';

/**
 * XLSX for the user import (T-M2-12, approved screens 4–5): the workbook's sheets and, sheet by sheet,
 * the rows as text — read from the file in memory (at most 20 MB) with every part inflated as a stream
 * under a hard limit. Formulas are never run: a formula cell gives the value Excel stored with it. Dates
 * (cells with a date format) are given as `YYYY-MM-DD`. Refused: macro-enabled workbooks (.xlsm, a VBA
 * project), encrypted entries, more than 50 sheets, two sheets in one part.
 *
 * Bounded work (security review H1): every part has its own inflate limit and all the parts read from one
 * opening share `limits.maxUnpackedBytes`; rows are produced asynchronously, letting the event loop run
 * every YIELD_BYTES of XML, so the worker's other work (and the lease's renewal) goes on.
 */
export interface XlsxSheet {
  readonly name: string;
  readonly hidden: boolean;
  /** The part holding the sheet (`xl/worksheets/sheet1.xml`). */
  readonly path: string;
}

export const MAX_SHEETS = 50;
/** Small parts (workbook, relationships, styles, content types). */
const SMALL_PART_BYTES = 8 * 1024 * 1024;
/** A sheet's XML may inflate to this much (10,000 rows × 200 short columns fit within it). */
const SHEET_PART_BYTES = 128 * 1024 * 1024;
const SHARED_STRINGS_BYTES = 64 * 1024 * 1024;
/** Characters of all shared strings together, and their number. */
const SHARED_STRINGS_CHARS = 32 * 1024 * 1024;
const SHARED_STRINGS_COUNT = 2_000_000;

const REL_OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_SHARED_STRINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const REL_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
/** The Strict variants of the same relationship types end the same way. */
const relType = (type: string, expected: string) =>
  type === expected || type.endsWith(expected.slice(expected.lastIndexOf('/')));

const unreadable = () => new SpreadsheetError('FILE_UNREADABLE');

interface Relationship {
  readonly type: string;
  readonly target: string;
}

/** Joins a relationship target to the folder of the part that names it (`xl/` + `worksheets/a.xml`). */
export function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return normalizeName(target);
  const parts = base.split('/').filter((p) => p !== '');
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return normalizeName(parts.join('/'));
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function relsPathOf(path: string): string {
  const folder = folderOf(path);
  const file = path.slice(folder === '' ? 0 : folder.length + 1);
  return `${folder === '' ? '' : `${folder}/`}_rels/${file}.rels`;
}

function readRelationships(zip: ZipArchive, path: string): Map<string, Relationship> {
  const rels = new Map<string, Relationship>();
  const relsPath = relsPathOf(path);
  if (!zip.has(relsPath)) return rels;
  const base = folderOf(path);
  parseXml(zip.chunks(relsPath, SMALL_PART_BYTES), {
    open(name, attributes) {
      if (name !== 'Relationship') return;
      const id = attribute(attributes, 'Id');
      const type = attribute(attributes, 'Type');
      const target = attribute(attributes, 'Target');
      const mode = attribute(attributes, 'TargetMode');
      if (id && type && target && mode !== 'External') {
        rels.set(id, { type, target: resolveTarget(base, target) });
      }
    },
  });
  return rels;
}

/** Excel's built-in number formats that show a date (14–17, 22, and the East Asian date formats). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/**
 * Does a custom number format show a date? Quoted text, escaped characters and bracketed sections
 * (colours, locales, elapsed time) do not count; a year or day token does, and so does a month token in
 * a format without hours or seconds.
 */
export function isDateFormat(code: string): boolean {
  let plain = '';
  let i = 0;
  while (i < code.length) {
    const char = code.charAt(i);
    if (char === '"') {
      const close = code.indexOf('"', i + 1);
      i = close === -1 ? code.length : close + 1;
    } else if (char === '\\' || char === '_' || char === '*') {
      i += 2;
    } else if (char === '[') {
      const close = code.indexOf(']', i + 1);
      i = close === -1 ? code.length : close + 1;
    } else {
      plain += char.toLowerCase();
      i += 1;
    }
  }
  // Only the first section (positive numbers) decides.
  const section = plain.split(';')[0] ?? '';
  if (/[yd]/.test(section)) return true;
  return section.includes('m') && !/[hs]/.test(section);
}

/** The cell styles (index in `cellXfs`) that show a date. */
function readDateStyles(zip: ZipArchive, path: string | null): Set<number> {
  const styles = new Set<number>();
  if (path === null || !zip.has(path)) return styles;
  const customDates = new Set<number>();
  let inCellXfs = false;
  let index = 0;
  parseXml(zip.chunks(path, SMALL_PART_BYTES), {
    open(name, attributes) {
      if (name === 'numFmt') {
        const id = Number(attribute(attributes, 'numFmtId'));
        const code = attribute(attributes, 'formatCode') ?? '';
        if (Number.isInteger(id) && isDateFormat(code)) customDates.add(id);
      } else if (name === 'cellXfs') {
        inCellXfs = true;
        index = 0;
      } else if (name === 'xf' && inCellXfs) {
        const id = Number(attribute(attributes, 'numFmtId') ?? '0');
        if (BUILTIN_DATE_FORMATS.has(id) || customDates.has(id)) styles.add(index);
        index += 1;
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return styles;
}

/**
 * Characters of a shared string kept for the cells that use it (security review, Low 1): one shared
 * string may be referenced by every cell of the sheet, and each cell's blank check would scan it whole.
 * The import works on at most 500 characters of a cell (users/rows.ts CELL_LIMIT); one more still says
 * "too long". A longer string is kept from its first visible character — worked out once per shared
 * string —, so a padded value is neither scanned per cell nor mistaken for a blank one.
 */
export const SHARED_STRING_KEEP = 501;

/** A shared string as the cells that use it see it. */
export function keptSharedString(value: string): string {
  if (value.length <= SHARED_STRING_KEEP) return value;
  const start = value.search(/\S/);
  return start < 0 ? '' : value.slice(start, start + SHARED_STRING_KEEP);
}

async function readSharedStrings(
  zip: ZipArchive,
  path: string | null,
  limits: ReadLimits,
): Promise<string[]> {
  const strings: string[] = [];
  if (path === null || !zip.has(path)) return strings;
  let total = 0;
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  await parseXmlAsync(zip.chunks(path, SHARED_STRINGS_BYTES), {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 'rPh') phonetic += 1;
      else if (name === 't' && current !== null && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === 't') inText = false;
      else if (name === 'rPh') phonetic -= 1;
      else if (name === 'si' && current !== null) {
        if (strings.length >= SHARED_STRINGS_COUNT) throw unreadable();
        // The whole string was checked against the cell limit as it was read (text() below).
        strings.push(keptSharedString(current));
        current = null;
      }
    },
    text(text) {
      if (!inText || current === null) return;
      current += text;
      total += text.length;
      if (current.length > limits.maxCellChars || total > SHARED_STRINGS_CHARS) throw unreadable();
    },
  });
  return strings;
}

/** Column letters of a cell reference (`AB12` → 27), or -1. */
export function columnIndex(reference: string): number {
  let index = 0;
  let letters = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) index = index * 26 + (code - 64);
    else if (code >= 97 && code <= 122) index = index * 26 + (code - 96);
    else break;
    letters += 1;
    if (letters > 3) return -1;
  }
  return letters === 0 ? -1 : index - 1;
}

const DAY_MS = 86_400_000;

/**
 * An Excel date serial as `YYYY-MM-DD` (the 1900 system with Excel's 29 February 1900, or the 1904
 * system); null when it is no date Excel could show.
 */
export function serialToIsoDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial >= 2_958_466) return null;
  const days = Math.floor(serial);
  let epoch: number;
  if (date1904) epoch = Date.UTC(1904, 0, 1);
  else if (days >= 61) epoch = Date.UTC(1899, 11, 30);
  else if (days === 60) return '1900-02-29';
  else epoch = Date.UTC(1899, 11, 31);
  return new Date(epoch + days * DAY_MS).toISOString().slice(0, 10);
}

/** A number as text without float noise (`0.1+0.2` → `0.3`; integers as they are). */
export function numberText(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw.trim();
  if (Number.isSafeInteger(value)) return String(value);
  return String(Number.parseFloat(value.toPrecision(15)));
}

/** Does the package declare a macro-enabled part ([Content_Types].xml)? */
function declaresMacros(zip: ZipArchive): boolean {
  if (!zip.has('[Content_Types].xml')) return false;
  const found = { macros: false };
  parseXml(zip.chunks('[Content_Types].xml', SMALL_PART_BYTES), {
    open(_name, attributes) {
      const type = attribute(attributes, 'ContentType') ?? '';
      if (type.toLowerCase().includes('macroenabled')) found.macros = true;
    },
  });
  return found.macros;
}

export class XlsxWorkbook {
  readonly sheets: readonly XlsxSheet[];
  private readonly date1904: boolean;
  private readonly sharedStringsPath: string | null;
  private readonly stylesPath: string | null;
  private sharedStrings: string[] | null = null;
  private dateStyles: Set<number> | null = null;

  constructor(
    private readonly zip: ZipArchive,
    private readonly limits: ReadLimits = DEFAULT_LIMITS,
  ) {
    if (zip.has('xl/vbaProject.bin')) throw new SpreadsheetError('FILE_MACROS');
    if (declaresMacros(zip)) throw new SpreadsheetError('FILE_MACROS');
    let workbookPath = 'xl/workbook.xml';
    for (const rel of readRelationships(zip, '').values()) {
      if (relType(rel.type, REL_OFFICE_DOCUMENT)) workbookPath = rel.target;
    }
    if (!zip.has(workbookPath)) throw unreadable();
    const rels = readRelationships(zip, workbookPath);
    let sharedStringsPath: string | null = null;
    let stylesPath: string | null = null;
    for (const rel of rels.values()) {
      if (relType(rel.type, REL_SHARED_STRINGS)) sharedStringsPath = rel.target;
      if (relType(rel.type, REL_STYLES)) stylesPath = rel.target;
    }
    this.sharedStringsPath = sharedStringsPath;
    this.stylesPath = stylesPath;

    const sheets: XlsxSheet[] = [];
    let date1904 = false;
    parseXml(zip.chunks(workbookPath, SMALL_PART_BYTES), {
      open(name, attributes) {
        if (name === 'workbookPr') {
          const value = attribute(attributes, 'date1904');
          date1904 = value === '1' || value === 'true';
        } else if (name === 'sheet') {
          const id = attribute(attributes, 'id', true);
          const rel = id === undefined ? undefined : rels.get(id);
          // Chart sheets and dialog sheets hold no rows: not offered.
          if (!rel || !relType(rel.type, REL_WORKSHEET) || !zip.has(rel.target)) return;
          if (sheets.length >= MAX_SHEETS) throw new SpreadsheetError('FILE_TOO_MANY_SHEETS');
          // Two sheets in one part: never written by spreadsheet programs, only to multiply the work.
          if (sheets.some((other) => other.path === rel.target)) throw unreadable();
          const state = attribute(attributes, 'state');
          sheets.push({
            name: (attribute(attributes, 'name') ?? '').slice(0, 100),
            hidden: state === 'hidden' || state === 'veryHidden',
            path: rel.target,
          });
        }
      },
    });
    if (sheets.length === 0) throw unreadable();
    this.sheets = sheets;
    this.date1904 = date1904;
  }

  /** Opens a workbook from its bytes; everything read from this opening shares one inflate budget. */
  static open(bytes: Uint8Array, limits: ReadLimits = DEFAULT_LIMITS): XlsxWorkbook {
    return new XlsxWorkbook(new ZipArchive(bytes, { remaining: limits.maxUnpackedBytes }), limits);
  }

  /**
   * The rows of a sheet as text, in order, skipping rows without text. Throws SpreadsheetError
   * FILE_TOO_MANY_COLUMNS (a value beyond the last allowed column) or FILE_UNREADABLE.
   */
  async *rows(sheetIndex: number): AsyncGenerator<SheetRow> {
    const sheet = this.sheets[sheetIndex];
    if (!sheet) throw unreadable();
    this.sharedStrings ??= await readSharedStrings(this.zip, this.sharedStringsPath, this.limits);
    this.dateStyles ??= readDateStyles(this.zip, this.stylesPath);
    const strings = this.sharedStrings;
    const dateStyles = this.dateStyles;
    const { maxColumns, maxCellChars } = this.limits;
    const date1904 = this.date1904;

    const ready: SheetRow[] = [];
    let inSheetData = false;
    let rowNumber = 0;
    let cells: string[] = [];
    let column = -1;
    let cellType = 'n';
    let cellStyle = 0;
    let value: string | null = null;
    let inline: string | null = null;
    let collecting: 'v' | 't' | null = null;
    let phonetic = 0;

    const cellText = (): string => {
      if (cellType === 'inlineStr') return inline ?? '';
      if (value === null) return '';
      switch (cellType) {
        case 's': {
          const index = Number(value);
          return Number.isInteger(index) ? (strings[index] ?? '') : '';
        }
        case 'str':
          return value;
        case 'b':
          return value.trim() === '1' ? 'TRUE' : 'FALSE';
        case 'e':
          return '';
        case 'd':
          return /^\d{4}-\d{2}-\d{2}/.test(value.trim()) ? value.trim().slice(0, 10) : value;
        default: {
          if (dateStyles.has(cellStyle)) {
            const date = serialToIsoDate(Number(value), date1904);
            if (date !== null) return date;
          }
          return numberText(value);
        }
      }
    };

    const stream = new XmlStream({
      open(name, attributes) {
        if (name === 'sheetData') {
          inSheetData = true;
        } else if (!inSheetData) {
          return;
        } else if (name === 'row') {
          const r = Number(attribute(attributes, 'r'));
          rowNumber = Number.isInteger(r) && r > rowNumber ? r : rowNumber + 1;
          if (rowNumber > 1_048_576) throw unreadable();
          cells = [];
          column = -1;
        } else if (name === 'c') {
          const reference = attribute(attributes, 'r');
          const at = reference === undefined ? -1 : columnIndex(reference);
          column = at >= 0 ? at : column + 1;
          cellType = attribute(attributes, 't') ?? 'n';
          cellStyle = Number(attribute(attributes, 's') ?? '0');
          value = null;
          inline = null;
        } else if (name === 'v') {
          collecting = 'v';
          value = '';
        } else if (name === 'is') {
          inline = '';
        } else if (name === 'rPh') {
          phonetic += 1;
        } else if (name === 't' && inline !== null && phonetic === 0) {
          collecting = 't';
        }
      },
      close(name) {
        if (name === 'sheetData') {
          inSheetData = false;
        } else if (!inSheetData) {
          return;
        } else if (name === 'v' || name === 't') {
          collecting = null;
        } else if (name === 'rPh') {
          phonetic -= 1;
        } else if (name === 'c') {
          const text = cellText();
          if (text.trim() !== '') {
            if (column >= maxColumns) throw new SpreadsheetError('FILE_TOO_MANY_COLUMNS');
            while (cells.length < column) cells.push('');
            cells[column] = text;
          }
        } else if (name === 'row') {
          if (cells.some((cell) => cell.trim() !== '')) {
            ready.push({ number: rowNumber, cells: [...cells] });
          }
        }
      },
      text(text) {
        if (collecting === 'v' && value !== null) {
          value += text;
          if (value.length > maxCellChars) throw unreadable();
        } else if (collecting === 't' && inline !== null) {
          inline += text;
          if (inline.length > maxCellChars) throw unreadable();
        }
      },
    });
    let since = 0;
    for (const chunk of this.zip.chunks(sheet.path, SHEET_PART_BYTES)) {
      stream.write(chunk);
      yield* ready.splice(0);
      since += chunk.length;
      if (since >= YIELD_BYTES) {
        since = 0;
        await yieldToLoop();
      }
    }
    stream.end();
    yield* ready.splice(0);
  }
}
