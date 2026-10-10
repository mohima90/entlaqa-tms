import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  csvCell,
  csvLine,
  detectDelimiter,
  neutralizeFormula,
  readCsvRows,
  unneutralizeFormula,
} from './csv';
import type { SheetRow } from './errors';

const encoder = new TextEncoder();

function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, at + size));
  return out;
}

async function read(
  text: string | Uint8Array,
  size = 1024,
  limits = { maxRows: 10_000, maxColumns: 200, maxCellChars: 32_767, maxUnpackedBytes: 1_000_000 },
): Promise<SheetRow[]> {
  const bytes = typeof text === 'string' ? encoder.encode(text) : text;
  const rows: SheetRow[] = [];
  for await (const row of readCsvRows(chunks(bytes, size), limits)) rows.push(row);
  return rows;
}

describe('readCsvRows', () => {
  it('reads quoted cells, separators and line breaks inside quotes, escaped quotes', async () => {
    const rows = await read(
      'البريد,الاسم الأول,ملاحظة\r\na@x.test,"نورة, فهد","سطر\nثانٍ"\r\nb@x.test,"قال ""نعم""",\r\n',
    );
    expect(rows).toEqual([
      { number: 1, cells: ['البريد', 'الاسم الأول', 'ملاحظة'] },
      { number: 2, cells: ['a@x.test', 'نورة, فهد', 'سطر\nثانٍ'] },
      { number: 3, cells: ['b@x.test', 'قال "نعم"'] },
    ]);
  });

  it('removes the BOM, accepts LF and lone CR line endings and a last line without one', async () => {
    const rows = await read(`${CSV_BOM}a,b\nc,d\re,f`);
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('is the same whatever the chunk boundaries (also inside a multi-byte letter)', async () => {
    const text = `${CSV_BOM}الاسم;"البريد; الثاني"\r\nنورة;"n@x.test"\r\n\r\nخالد;k@x.test\r\n`;
    const whole = await read(text, 1 << 20);
    for (const size of [1, 2, 3, 7]) expect(await read(text, size)).toEqual(whole);
    expect(whole).toEqual([
      { number: 1, cells: ['الاسم', 'البريد; الثاني'] },
      { number: 2, cells: ['نورة', 'n@x.test'] },
      { number: 4, cells: ['خالد', 'k@x.test'] },
    ]);
  });

  it('skips rows without text but keeps counting them; trims trailing empty cells', async () => {
    const rows = await read('a,b,,,\n,,\n  ,\nc,,d,,\n');
    expect(rows).toEqual([
      { number: 1, cells: ['a', 'b'] },
      { number: 4, cells: ['c', '', 'd'] },
    ]);
  });

  it('uses semicolons when the header line has more of them than commas', async () => {
    expect(detectDelimiter('a;b;c,d')).toBe(';');
    expect(detectDelimiter('a,b;c')).toBe(',');
    expect(detectDelimiter('"a;b;c",d')).toBe(',');
    expect((await read('a;b\n1,5;2\n')).map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });

  it('decides the separator for a single line without a line break', async () => {
    expect((await read('a;b;c')).map((r) => r.cells)).toEqual([['a', 'b', 'c']]);
  });

  it('keeps text after a closing quote as part of the cell', async () => {
    expect((await read('"ab"cd,e\n')).map((r) => r.cells)).toEqual([['abcd', 'e']]);
  });

  it('refuses another encoding (Windows-1256 Arabic, UTF-16)', async () => {
    // «محمد» in Windows-1256.
    await expect(read(new Uint8Array([0xe3, 0xcd, 0xe3, 0xcf, 0x2c, 0x61]))).rejects.toMatchObject({
      code: 'FILE_ENCODING',
    });
    await expect(read(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).rejects.toMatchObject({
      code: 'FILE_ENCODING',
    });
  });

  it('refuses a value beyond the last allowed column; empty cells beyond it are fine', async () => {
    const limits = { maxRows: 10, maxColumns: 3, maxCellChars: 100, maxUnpackedBytes: 1_000_000 };
    expect((await read('a,b,c,,,\n', 64, limits)).map((r) => r.cells)).toEqual([['a', 'b', 'c']]);
    await expect(read('a,b,c,d\n', 64, limits)).rejects.toMatchObject({
      code: 'FILE_TOO_MANY_COLUMNS',
    });
  });

  it('refuses a cell longer than the limit and a quote never closed', async () => {
    const limits = { maxRows: 10, maxColumns: 3, maxCellChars: 5, maxUnpackedBytes: 1_000_000 };
    await expect(read('abcdef\n', 64, limits)).rejects.toMatchObject({ code: 'FILE_UNREADABLE' });
    await expect(read('a,"bc\n')).rejects.toMatchObject({ code: 'FILE_UNREADABLE' });
  });

  it('reads an empty file as no rows', async () => {
    expect(await read('')).toEqual([]);
    expect(await read(CSV_BOM)).toEqual([]);
  });
});

describe('formula neutralization (TM-0003 T-IAM-19)', () => {
  it('puts a quote in front of cells a spreadsheet would run', () => {
    for (const value of [
      '=HYPERLINK("https://example.test")',
      '+966551234567',
      '-2+3',
      '@SUM(A1)',
      '\tx',
      '\rx',
      '  =1+1',
      '＝1+1',
      '＠x',
    ]) {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
      expect(unneutralizeFormula(neutralizeFormula(value))).toBe(value);
    }
  });

  it('leaves other text alone, also a leading apostrophe of its own', () => {
    for (const value of ['نورة', 'a=b', 'EMP-1', "'s-Hertogenbosch", '', ' text ']) {
      expect(neutralizeFormula(value)).toBe(value);
      expect(unneutralizeFormula(value)).toBe(value);
    }
  });

  it('writes CSV cells quoted when needed, neutralized first', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' x')).toBe('" x"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
    expect(csvLine(['a', '=b', 'c d'])).toBe("a,'=b,c d\r\n");
  });

  it('round-trips through the reader', async () => {
    const values = ['=cmd|calc', 'نورة, فهد', 'say "hi"', '+1 555', 'x'];
    const rows = await read(`${CSV_BOM}${csvLine(values)}`);
    expect(rows[0]?.cells.map(unneutralizeFormula)).toEqual(values);
  });
});
