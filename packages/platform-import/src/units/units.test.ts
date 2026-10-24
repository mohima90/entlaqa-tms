import type { UnitImportContext } from '@jadarat/platform-db';
import { describe, expect, it } from 'vitest';
import { XlsxWorkbook } from '../spreadsheet/xlsx';
import {
  UNIT_COLUMNS,
  type UnitColumn,
  type UnitFileRow,
  checkUnitRows,
  headEmailsOf,
  readUnitFile,
  unitTemplateFileName,
  unitTemplateXlsx,
} from './units';

const encode = (text: string) => new TextEncoder().encode(text);

const CONTEXT: UnitImportContext = {
  levels: [
    { ordinal: 1, nameEn: 'Sector', nameAr: 'قطاع' },
    { ordinal: 2, nameEn: 'Department', nameAr: 'إدارة' },
    { ordinal: 3, nameEn: 'Section', nameAr: 'قسم' },
  ],
  units: [
    { id: 'u-ops', code: 'OPS', parentId: null, levelOrdinal: 1, version: 3 },
    { id: 'u-fin', code: 'FIN', parentId: 'u-ops', levelOrdinal: 2, version: 1 },
  ],
  branches: [{ id: 'b-ruh', code: 'RUH' }],
  costCentres: [
    { id: 'cc-100', code: 'CC-100', active: true },
    { id: 'cc-900', code: 'CC-900', active: false },
  ],
  people: [{ id: 'p-sara', email: 'sara@example.test' }],
  costCentresAvailable: true,
};

let nextRow = 2;
function row(cells: Partial<Record<UnitColumn, string>>): UnitFileRow {
  const all = Object.fromEntries(UNIT_COLUMNS.map((c) => [c.key, cells[c.key] ?? ''])) as Record<
    UnitColumn,
    string
  >;
  return { row: nextRow++, cells: all };
}

const unit = (
  code: string,
  level: string,
  parentCode = '',
  extra: Partial<Record<UnitColumn, string>> = {},
) => row({ code, level, parentCode, nameEn: `${code} en`, nameAr: `${code} ar`, ...extra });

describe('unit import template (WP-HR-01)', () => {
  it('has the headers only, in both languages', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const book = XlsxWorkbook.open(unitTemplateXlsx(locale), {
        maxRows: 10,
        maxColumns: 20,
        maxCellChars: 200,
        maxUnpackedBytes: 1024 * 1024,
      });
      const rows = [];
      for await (const r of book.rows(0)) rows.push(r);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cells).toEqual(UNIT_COLUMNS.map((c) => c[locale]));
    }
    expect(unitTemplateFileName('en')).toBe('unit-import-template.xlsx');
  });
});

describe('readUnitFile', () => {
  it('reads CSV rows by English or Arabic headers, skipping blank lines', async () => {
    const read = await readUnitFile(
      encode(
        'Level,Code,Name (English),Name (Arabic),Parent code\nSector,HR,People,الموارد,\n,,,,\n',
      ),
    );
    expect(read.ok && read.rows.map((r) => r.cells.code)).toEqual(['HR']);
    const arabic = await readUnitFile(
      encode('المستوى,الرمز,الاسم (إنجليزي),الاسم (عربي)\nقطاع,IT,IT,تقنية\n'),
    );
    expect(arabic.ok && arabic.rows[0]?.cells.nameAr).toBe('تقنية');
  });

  it('refuses a file without the needed columns, an empty file or one too large', async () => {
    expect(await readUnitFile(encode('Code,Name\nA,B\n'))).toEqual({
      ok: false,
      problem: 'FILE_COLUMNS',
    });
    expect(await readUnitFile(new Uint8Array())).toEqual({ ok: false, problem: 'FILE_EMPTY' });
    expect(await readUnitFile(encode('Level,Code,Name (English),Name (Arabic)\n'))).toEqual({
      ok: false,
      problem: 'FILE_EMPTY',
    });
    expect(await readUnitFile(new Uint8Array(512 * 1024 + 1))).toEqual({
      ok: false,
      problem: 'FILE_UNREADABLE',
    });
  });
});

describe('checkUnitRows (EP-ORG-structure-completion §3 D)', () => {
  it('creates new units under existing units or under rows above, and updates existing codes', () => {
    const check = checkUnitRows(
      [
        unit('HR', 'Sector', '', {
          branchCode: 'ruh',
          costCentreCode: 'cc-100',
          headEmail: 'SARA@example.test',
        }),
        unit('TD', 'Department', 'HR'),
        unit('LD', 'قسم', 'td'),
        unit('AP', '3', 'FIN'),
        unit('FIN', 'Department', 'OPS', { nameEn: 'Finance' }),
      ],
      CONTEXT,
    );
    expect(check.rows.map((r) => r.result)).toEqual(['new', 'new', 'new', 'new', 'update']);
    expect(check.counts).toEqual({ read: 5, created: 4, updated: 1, problems: 0 });
    expect(check.operations[0]).toMatchObject({
      kind: 'create',
      parentId: null,
      parentCode: null,
      branchId: 'b-ruh',
      defaultCostCentreId: 'cc-100',
      headPersonId: 'p-sara',
    });
    expect(check.operations[1]).toMatchObject({ kind: 'create', parentId: null, parentCode: 'hr' });
    expect(check.operations[3]).toMatchObject({
      kind: 'create',
      parentId: 'u-fin',
      parentCode: null,
    });
    expect(check.operations[4]).toMatchObject({
      kind: 'update',
      id: 'u-fin',
      version: 1,
      nameEn: 'Finance',
    });
  });

  it('names the problem of each refused row and skips it', () => {
    const check = checkUnitRows(
      [
        unit('X1', 'Division'),
        unit('bad code', 'Sector'),
        unit('S1', 'Sector'),
        unit('S1', 'Sector'),
        row({ code: 'S2', level: 'Sector', nameEn: 'Only English' }),
        unit('S3', 'Sector', 'OPS'),
        unit('D1', 'Department'),
        unit('D2', 'Department', 'NOPE'),
        unit('D3', 'Section', 'OPS'),
        unit('D4', 'Department', 'OPS', { branchCode: 'JED' }),
        unit('D5', 'Department', 'OPS', { costCentreCode: 'CC-404' }),
        unit('D6', 'Department', 'OPS', { costCentreCode: 'CC-900' }),
        unit('FIN', 'Sector'),
        unit('FIN', 'Department', 'S1'),
      ],
      CONTEXT,
    );
    expect(check.rows.map((r) => r.issue)).toEqual([
      'LEVEL_UNKNOWN',
      'CODE_INVALID',
      null,
      'CODE_REPEATED',
      'NAME_REQUIRED',
      'PARENT_NOT_ALLOWED',
      'PARENT_REQUIRED',
      'PARENT_NOT_FOUND',
      'PARENT_WRONG_LEVEL',
      'BRANCH_NOT_FOUND',
      'COST_CENTRE_NOT_FOUND',
      'COST_CENTRE_INACTIVE',
      'LEVEL_CHANGE',
      'CODE_REPEATED',
    ]);
    expect(check.counts.problems).toBe(13);
    expect(check.operations).toHaveLength(1);
  });

  it('never moves an existing unit; a head not found is a warning; the name is too long', () => {
    const check = checkUnitRows(
      [
        unit('FIN', 'Department', 'OTHER'),
        unit('NEW', 'Sector', '', { headEmail: 'nobody@example.test' }),
        unit('LONG', 'Sector', '', { nameEn: 'x'.repeat(201) }),
      ],
      CONTEXT,
    );
    expect(check.rows.map((r) => [r.result, r.issue])).toEqual([
      ['problem', 'PARENT_CHANGE'],
      ['new', 'HEAD_NOT_FOUND'],
      ['problem', 'NAME_TOO_LONG'],
    ]);
    expect(check.operations[0]).toMatchObject({ code: 'NEW', headPersonId: null });
  });

  it('ignores the cost-centre column before the migration (deploy window)', () => {
    const check = checkUnitRows([unit('S9', 'Sector', '', { costCentreCode: 'CC-404' })], {
      ...CONTEXT,
      costCentresAvailable: false,
    });
    expect(check.rows[0]?.result).toBe('new');
    expect(check.operations[0]).toMatchObject({ defaultCostCentreId: null });
  });

  it('looks up only the e-mails the file names', () => {
    expect(
      headEmailsOf([unit('A', 'Sector', '', { headEmail: 'A@Example.test' }), unit('B', 'Sector')]),
    ).toEqual(['a@example.test']);
  });
});
