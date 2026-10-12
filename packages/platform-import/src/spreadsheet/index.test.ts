import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvLine } from './csv';
import { CSV_TYPE, XLSX_TYPE, kindOfType, openSpreadsheet, readAll, summarizeSheet } from './index';
import { writeXlsx } from './xlsx-writer';

const encode = (text: string) => new TextEncoder().encode(text);

async function collect<T>(rows: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

describe('opening an import file', () => {
  it('knows the kinds by the type the scan found', () => {
    expect(kindOfType(CSV_TYPE)).toBe('csv');
    expect(kindOfType(XLSX_TYPE)).toBe('xlsx');
    expect(kindOfType('application/zip')).toBeNull();
    expect(kindOfType(null)).toBeNull();
  });

  it('reads a stream into memory up to a limit', async () => {
    expect(await readAll([encode('ab'), encode('cd')], 4)).toEqual(encode('abcd'));
    await expect(readAll([encode('abc'), encode('de')], 4)).rejects.toMatchObject({
      code: 'FILE_UNREADABLE',
    });
  });

  it('CSV: one unnamed sheet, read once', async () => {
    const file = await openSpreadsheet(
      'csv',
      [encode(`${CSV_BOM}${csvLine(['a', 'b'])}${csvLine(['1', '2'])}`)],
      {
        maxBytes: 100,
      },
    );
    expect(file.sheets).toEqual([{ name: '', hidden: false }]);
    const rows = [];
    for await (const row of file.rows(0)) rows.push(row);
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => file.rows(0)).toThrow(expect.objectContaining({ code: 'FILE_UNREADABLE' }));
  });

  it('XLSX: every sheet, any number of times; a non-ZIP refused', async () => {
    const bytes = writeXlsx([
      { name: 'أ', rightToLeft: true, columns: [], rows: [['x'], ['1']] },
      { name: 'ب', rightToLeft: true, columns: [], rows: [['y']] },
    ]);
    const file = await openSpreadsheet('xlsx', [bytes], { maxBytes: 1_000_000 });
    expect(file.sheets).toEqual([
      { name: 'أ', hidden: false },
      { name: 'ب', hidden: false },
    ]);
    expect(await collect(file.rows(0))).toHaveLength(2);
    expect(await collect(file.rows(0))).toHaveLength(2);
    await expect(
      openSpreadsheet('xlsx', [encode('not a zip')], { maxBytes: 100 }),
    ).rejects.toMatchObject({
      code: 'FILE_UNREADABLE',
    });
  });

  it('summarizes a sheet: header, data rows, columns and up to 3 short samples', async () => {
    const summary = await summarizeSheet(
      [
        { number: 3, cells: [' Email ', 'الاسم'] },
        { number: 4, cells: ['a@x.test', ''] },
        { number: 5, cells: ['b@x.test', 'نورة', 'extra'] },
        { number: 6, cells: ['c@x.test', 'x'.repeat(150)] },
        { number: 7, cells: ['d@x.test'] },
      ],
      { name: 'S', hidden: true },
    );
    expect(summary).toEqual({
      name: 'S',
      hidden: true,
      headerRow: 3,
      header: ['Email', 'الاسم'],
      rows: 4,
      columns: 3,
      samples: [['a@x.test', 'b@x.test', 'c@x.test'], ['نورة', 'x'.repeat(100)], ['extra']],
    });
    expect(await summarizeSheet([], { name: '', hidden: false })).toEqual({
      name: '',
      hidden: false,
      headerRow: null,
      header: [],
      rows: 0,
      columns: 0,
      samples: [],
    });
  });
});
