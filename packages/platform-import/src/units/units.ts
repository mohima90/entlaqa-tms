import type { UnitImportContext, UnitImportOperation } from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { readCsvRows } from '../spreadsheet/csv';
import { type SheetRow, SpreadsheetError } from '../spreadsheet/errors';
import { XlsxWorkbook } from '../spreadsheet/xlsx';
import { writeXlsx } from '../spreadsheet/xlsx-writer';
import { looksLikeZip } from '../spreadsheet/zip';

/**
 * Importing units of the structure from a file (WP-HR-01; FR-ADM-05; business flow EP-ORG-structure-completion.md
 * §3 D, PO 24 Oct 2026): the template, reading a CSV or XLSX file (bounded — the spreadsheet reader of the people
 * import), and checking every row before anything is written. Rows are read top to bottom, so a parent can be in
 * an earlier row of the same file. A new code creates a unit; an existing code updates its names, branch, default
 * cost centre and head; the parent of an existing unit never changes here (moves are made on the Structure page,
 * with their preview). Problems name the row and a code, never the file's content.
 */
export const UNIT_IMPORT_MAX_ROWS = 2_000;
/** The file as sent by the browser: a few hundred kilobytes cover 2,000 rows. */
export const UNIT_IMPORT_MAX_BYTES = 512 * 1024;

export type UnitColumn =
  | 'level'
  | 'code'
  | 'nameEn'
  | 'nameAr'
  | 'parentCode'
  | 'branchCode'
  | 'costCentreCode'
  | 'headEmail';

export const UNIT_COLUMNS: readonly {
  readonly key: UnitColumn;
  readonly en: string;
  readonly ar: string;
}[] = [
  { key: 'level', en: 'Level', ar: 'المستوى' },
  { key: 'code', en: 'Code', ar: 'الرمز' },
  { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)' },
  { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)' },
  { key: 'parentCode', en: 'Parent code', ar: 'رمز الوحدة الأعلى' },
  { key: 'branchCode', en: 'Branch code', ar: 'رمز الفرع' },
  { key: 'costCentreCode', en: 'Default cost centre code', ar: 'رمز مركز التكلفة الافتراضي' },
  { key: 'headEmail', en: 'Head (e-mail)', ar: 'الرئيس (البريد الإلكتروني)' },
];

export type UnitTemplateLocale = 'ar' | 'en';

/** The template: one sheet with the headers (no example rows: they cannot be imported by mistake). */
export function unitTemplateXlsx(locale: UnitTemplateLocale): Uint8Array<ArrayBuffer> {
  return writeXlsx([
    {
      name: locale === 'ar' ? 'الوحدات' : 'Units',
      rightToLeft: locale === 'ar',
      columns: UNIT_COLUMNS.map((c) => ({
        width: c.key.startsWith('name') ? 32 : 22,
        format: 'text',
      })),
      rows: [UNIT_COLUMNS.map((c) => c[locale])],
      freezeHeader: true,
    },
  ]);
}

/** The CSV template: the header row only, UTF-8 with a byte-order mark (Excel then reads Arabic headers). */
export function unitTemplateCsv(locale: UnitTemplateLocale): Uint8Array<ArrayBuffer> {
  const line = UNIT_COLUMNS.map((c) => c[locale]).join(',');
  return new TextEncoder().encode(`\uFEFF${line}\r\n`);
}

export function unitTemplateFileName(
  locale: UnitTemplateLocale,
  format: 'xlsx' | 'csv' = 'xlsx',
): string {
  return locale === 'ar' ? `قالب-استيراد-الوحدات.${format}` : `unit-import-template.${format}`;
}

/** One data row as read, by column. */
export interface UnitFileRow {
  readonly row: number;
  readonly cells: Readonly<Record<UnitColumn, string>>;
}

export type UnitFileProblem = 'FILE_COLUMNS' | 'FILE_TOO_MANY_ROWS' | 'FILE_EMPTY';

export type UnitFileRead =
  | {
      readonly ok: true;
      readonly rows: readonly UnitFileRow[];
      /** The columns the file has (an optional column left out keeps the current values on updates). */
      readonly columns: readonly UnitColumn[];
    }
  | { readonly ok: false; readonly problem: UnitFileProblem | SpreadsheetError['code'] };

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Reads the file's first sheet (XLSX) or its rows (CSV, UTF-8): header row first, then data rows. */
export async function readUnitFile(bytes: Uint8Array): Promise<UnitFileRead> {
  if (bytes.length === 0) return { ok: false, problem: 'FILE_EMPTY' };
  if (bytes.length > UNIT_IMPORT_MAX_BYTES) return { ok: false, problem: 'FILE_UNREADABLE' };
  const limits = {
    maxRows: UNIT_IMPORT_MAX_ROWS,
    maxColumns: 40,
    maxCellChars: 1_000,
    maxUnpackedBytes: 32 * 1024 * 1024,
  };
  try {
    let source: AsyncIterable<SheetRow>;
    if (looksLikeZip(bytes)) {
      const workbook = XlsxWorkbook.open(bytes, limits);
      const sheet = workbook.sheets.findIndex((s) => !s.hidden);
      if (sheet < 0) return { ok: false, problem: 'FILE_EMPTY' };
      source = workbook.rows(sheet);
    } else {
      source = readCsvRows([bytes], limits);
    }
    let positions: Partial<Record<UnitColumn, number>> | null = null;
    const rows: UnitFileRow[] = [];
    for await (const row of source) {
      if (positions === null) {
        const found: Partial<Record<UnitColumn, number>> = {};
        row.cells.forEach((cell, index) => {
          const header = normalizeHeader(cell);
          const column = UNIT_COLUMNS.find(
            (c) => normalizeHeader(c.en) === header || normalizeHeader(c.ar) === header,
          );
          if (column && found[column.key] === undefined) found[column.key] = index;
        });
        // Level, code and both names are needed; the other columns may be left out.
        if (
          ['level', 'code', 'nameEn', 'nameAr'].some(
            (key) => found[key as UnitColumn] === undefined,
          )
        ) {
          return { ok: false, problem: 'FILE_COLUMNS' };
        }
        positions = found;
        continue;
      }
      if (rows.length >= UNIT_IMPORT_MAX_ROWS) return { ok: false, problem: 'FILE_TOO_MANY_ROWS' };
      const at = positions;
      const cells = Object.fromEntries(
        UNIT_COLUMNS.map((c) => {
          const index = at[c.key];
          return [c.key, index === undefined ? '' : (row.cells[index] ?? '').trim()];
        }),
      ) as Record<UnitColumn, string>;
      // A blank line in the sheet is not a row to check.
      if (Object.values(cells).every((value) => value === '')) continue;
      rows.push({ row: row.number, cells });
    }
    if (positions === null || rows.length === 0) return { ok: false, problem: 'FILE_EMPTY' };
    return {
      ok: true,
      rows,
      columns: UNIT_COLUMNS.map((c) => c.key).filter((key) => positions[key] !== undefined),
    };
  } catch (error) {
    if (error instanceof SpreadsheetError) return { ok: false, problem: error.code };
    throw error;
  }
}

/** Why a row is not imported, or a warning it carries. */
export type UnitRowIssue =
  | 'LEVEL_UNKNOWN'
  | 'CODE_INVALID'
  | 'CODE_REPEATED'
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'PARENT_REQUIRED'
  | 'PARENT_NOT_ALLOWED'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_WRONG_LEVEL'
  | 'PARENT_CHANGE'
  | 'LEVEL_CHANGE'
  | 'BRANCH_NOT_FOUND'
  | 'COST_CENTRE_NOT_FOUND'
  | 'COST_CENTRE_INACTIVE'
  /** A warning: the row is imported without a head. */
  | 'HEAD_NOT_FOUND';

export interface UnitRowResult {
  readonly row: number;
  readonly code: string;
  readonly name: string;
  readonly level: string;
  readonly result: 'new' | 'update' | 'problem';
  readonly issue: UnitRowIssue | null;
}

export interface UnitCheck {
  readonly rows: readonly UnitRowResult[];
  readonly operations: readonly UnitImportOperation[];
  readonly counts: {
    readonly read: number;
    readonly created: number;
    readonly updated: number;
    readonly problems: number;
  };
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** The e-mails a file names as heads (to look up only those people). */
export function headEmailsOf(rows: readonly UnitFileRow[]): string[] {
  return rows.map((r) => r.cells.headEmail.toLowerCase()).filter((email) => email.includes('@'));
}

/** Checks every row against the organization and the rows above it; nothing is written. */
export function checkUnitRows(
  rows: readonly UnitFileRow[],
  context: UnitImportContext,
  /** The file's columns (all by default): an optional column left out never clears a value (review 24 Oct). */
  columns: readonly UnitColumn[] = UNIT_COLUMNS.map((c) => c.key),
): UnitCheck {
  const has = new Set(columns);
  const levelByName = new Map<string, number>();
  for (const level of context.levels) {
    levelByName.set(normalizeHeader(level.nameEn), level.ordinal);
    levelByName.set(normalizeHeader(level.nameAr), level.ordinal);
    levelByName.set(String(level.ordinal), level.ordinal);
  }
  const existing = new Map(context.units.map((u) => [u.code.toLowerCase(), u]));
  const unitById = new Map(context.units.map((u) => [u.id, u]));
  const branches = new Map(context.branches.map((b) => [b.code.toLowerCase(), b.id]));
  const costCentres = new Map(context.costCentres.map((c) => [c.code.toLowerCase(), c]));
  const people = new Map(context.people.map((p) => [p.email, p.id]));
  /** Codes created by good rows above, with their level. */
  const createdAbove = new Map<string, number>();
  const seen = new Set<string>();
  const results: UnitRowResult[] = [];
  const operations: UnitImportOperation[] = [];

  for (const { row, cells } of rows) {
    const code = cells.code;
    const name = cells.nameEn || cells.nameAr;
    const problem = (issue: UnitRowIssue) => {
      results.push({ row, code, name, level: cells.level, result: 'problem', issue });
    };
    const ordinal = levelByName.get(normalizeHeader(cells.level));
    if (ordinal === undefined) {
      problem('LEVEL_UNKNOWN');
      continue;
    }
    if (!CODE.test(code)) {
      problem('CODE_INVALID');
      continue;
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      problem('CODE_REPEATED');
      continue;
    }
    seen.add(key);
    // A name of spaces or invisible characters only counts as missing (the database refuses it too).
    if (!hasVisibleText(cells.nameEn) || !hasVisibleText(cells.nameAr)) {
      problem('NAME_REQUIRED');
      continue;
    }
    if (cells.nameEn.length > 200 || cells.nameAr.length > 200) {
      problem('NAME_TOO_LONG');
      continue;
    }
    let branchId: string | null = null;
    if (cells.branchCode !== '') {
      branchId = branches.get(cells.branchCode.toLowerCase()) ?? null;
      if (branchId === null) {
        problem('BRANCH_NOT_FOUND');
        continue;
      }
    }
    let costCentreId: string | null = null;
    if (cells.costCentreCode !== '' && context.costCentresAvailable) {
      const costCentre = costCentres.get(cells.costCentreCode.toLowerCase());
      if (!costCentre) {
        problem('COST_CENTRE_NOT_FOUND');
        continue;
      }
      if (!costCentre.active) {
        problem('COST_CENTRE_INACTIVE');
        continue;
      }
      costCentreId = costCentre.id;
    }
    const headEmail = cells.headEmail.toLowerCase();
    const headPersonId = headEmail === '' ? null : (people.get(headEmail) ?? null);
    const headWarning: UnitRowIssue | null =
      headEmail !== '' && headPersonId === null ? 'HEAD_NOT_FOUND' : null;
    const parentKey = cells.parentCode.toLowerCase();
    const current = existing.get(key);

    if (current) {
      // An existing unit: its names, branch, default cost centre and head; never its level or parent.
      if (current.levelOrdinal !== ordinal) {
        problem('LEVEL_CHANGE');
        continue;
      }
      const currentParent = current.parentId === null ? null : unitById.get(current.parentId);
      if (parentKey !== '' && currentParent?.code.toLowerCase() !== parentKey) {
        problem('PARENT_CHANGE');
        continue;
      }
      operations.push({
        kind: 'update',
        row,
        id: current.id,
        version: current.version,
        nameEn: cells.nameEn,
        nameAr: cells.nameAr,
        // A column left out keeps the unit's value; an empty cell clears it; a head not found stays as is.
        branchId: has.has('branchCode') ? branchId : undefined,
        defaultCostCentreId:
          has.has('costCentreCode') && context.costCentresAvailable ? costCentreId : undefined,
        headPersonId: has.has('headEmail') && headWarning === null ? headPersonId : undefined,
      });
      results.push({ row, code, name, level: cells.level, result: 'update', issue: headWarning });
      continue;
    }

    // A new unit: at the top for the first level, else under a unit of the level above.
    let parentId: string | null = null;
    let parentCode: string | null = null;
    if (ordinal === 1) {
      if (parentKey !== '') {
        problem('PARENT_NOT_ALLOWED');
        continue;
      }
    } else {
      if (parentKey === '') {
        problem('PARENT_REQUIRED');
        continue;
      }
      const parentUnit = existing.get(parentKey);
      const parentLevel = parentUnit ? parentUnit.levelOrdinal : createdAbove.get(parentKey);
      if (parentLevel === undefined) {
        problem('PARENT_NOT_FOUND');
        continue;
      }
      if (parentLevel !== ordinal - 1) {
        problem('PARENT_WRONG_LEVEL');
        continue;
      }
      if (parentUnit) parentId = parentUnit.id;
      else parentCode = parentKey;
    }
    createdAbove.set(key, ordinal);
    operations.push({
      kind: 'create',
      row,
      code,
      nameEn: cells.nameEn,
      nameAr: cells.nameAr,
      parentId,
      parentCode,
      branchId,
      defaultCostCentreId: costCentreId,
      headPersonId,
    });
    results.push({ row, code, name, level: cells.level, result: 'new', issue: headWarning });
  }

  return {
    rows: results,
    operations,
    counts: {
      read: rows.length,
      created: results.filter((r) => r.result === 'new').length,
      updated: results.filter((r) => r.result === 'update').length,
      problems: results.filter((r) => r.result === 'problem').length,
    },
  };
}
