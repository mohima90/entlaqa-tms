import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { SheetRow } from './errors';
import {
  SHARED_STRING_KEEP,
  XlsxWorkbook,
  columnIndex,
  isDateFormat,
  keptSharedString,
  numberText,
  resolveTarget,
  serialToIsoDate,
} from './xlsx';
import { columnLetters, sheetReference, writeXlsx, xmlText } from './xlsx-writer';
import { MAX_XML_GAP } from './xml';
import { ZipArchive, looksLikeZip } from './zip';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

interface Part {
  readonly name: string;
  readonly hidden?: boolean;
  readonly xml: string;
  readonly chart?: boolean;
}

/** A workbook from raw parts (what other writers produce), for the reader's tests. */
function workbook(
  sheets: readonly Part[],
  extra: {
    sharedStrings?: string;
    styles?: string;
    date1904?: boolean;
    files?: Record<string, string>;
  } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`,
    ),
  };
  const rels: string[] = [];
  const entries: string[] = [];
  sheets.forEach((sheet, i) => {
    const id = `rId${String(i + 1)}`;
    const folder = sheet.chart ? 'chartsheets' : 'worksheets';
    rels.push(
      `<Relationship Id="${id}" Type="${R}/${sheet.chart ? 'chartsheet' : 'worksheet'}" Target="${folder}/s${String(i + 1)}.xml"/>`,
    );
    entries.push(
      `<sheet name="${sheet.name}" sheetId="${String(i + 1)}"${sheet.hidden ? ' state="hidden"' : ''} r:id="${id}"/>`,
    );
    files[`xl/${folder}/s${String(i + 1)}.xml`] = strToU8(sheet.xml);
  });
  if (extra.sharedStrings !== undefined) {
    rels.push(`<Relationship Id="rS" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>`);
    files['xl/sharedStrings.xml'] = strToU8(extra.sharedStrings);
  }
  if (extra.styles !== undefined) {
    rels.push(`<Relationship Id="rT" Type="${R}/styles" Target="styles.xml"/>`);
    files['xl/styles.xml'] = strToU8(extra.styles);
  }
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `<workbook xmlns="${MAIN}" xmlns:r="${R}">${extra.date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>${entries.join('')}</sheets></workbook>`,
  );
  for (const [name, text] of Object.entries(extra.files ?? {})) files[name] = strToU8(text);
  return zipSync(files);
}

const sheetXml = (rows: string) =>
  `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`;

async function rowsOf(book: XlsxWorkbook, index = 0): Promise<SheetRow[]> {
  const out: SheetRow[] = [];
  for await (const row of book.rows(index)) out.push(row);
  return out;
}

describe('XlsxWorkbook', () => {
  it('reads shared strings (rich text, without phonetic hints), inline strings, numbers, formulas, booleans', async () => {
    const bytes = workbook(
      [
        {
          name: 'الموظفون',
          xml: sheetXml(
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>رقم</t></is></c></row>' +
              '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>551234567</v></c><c r="D3" t="str"><f>A3&amp;"x"</f><v>محسوب</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" t="e"><v>#N/A</v></c><c r="G3"><v>0.30000000000000004</v></c></row>' +
              '<row><c t="inlineStr"><is><r><t>نو</t></r><r><t>رة</t></r></is></c><c><f>1+1</f></c></row>',
          ),
        },
      ],
      {
        sharedStrings: `<sst xmlns="${MAIN}"><si><t>البريد</t></si><si><r><t xml:space="preserve">الاسم </t></r><r><t>الأول</t></r><rPh><t>ignored</t></rPh></si><si><t>a@x.test</t></si></sst>`,
      },
    );
    expect(looksLikeZip(bytes)).toBe(true);
    const book = XlsxWorkbook.open(bytes);
    expect(book.sheets).toEqual([
      { name: 'الموظفون', hidden: false, path: 'xl/worksheets/s1.xml' },
    ]);
    expect(await rowsOf(book)).toEqual([
      { number: 1, cells: ['البريد', 'الاسم الأول', 'رقم'] },
      { number: 3, cells: ['a@x.test', '', '551234567', 'محسوب', 'TRUE', '', '0.3'] },
      { number: 4, cells: ['نورة'] },
    ]);
  });

  it('gives date cells as YYYY-MM-DD (built-in and custom formats, 1904 system, ISO cells)', async () => {
    const styles = `<styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="&quot;EMP&quot;0"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;
    const xml = sheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>تاريخ</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>45354</v></c><c r="B2" s="2"><v>43786.5</v></c><c r="C2" s="3"><v>45354</v></c><c r="D2" t="d"><v>2024-03-03T00:00:00</v></c><c r="E2" s="1"><v>-5</v></c></row>',
    );
    expect(
      (await rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml }], { styles }))))[1],
    ).toEqual({
      number: 2,
      cells: ['2024-03-03', '2019-11-17', '45354', '2024-03-03', '-5'],
    });
    expect(
      (
        await rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml }], { styles, date1904: true })))
      )[1]?.cells[0],
    ).toBe('2028-03-04');
  });

  it('lists worksheets only (chart sheets skipped), with hidden ones marked; any sheet by index', async () => {
    const book = XlsxWorkbook.open(
      workbook([
        {
          name: 'أولى',
          xml: sheetXml('<row r="1"><c r="B1" t="inlineStr"><is><t>x</t></is></c></row>'),
        },
        { name: 'رسم', chart: true, xml: `<chartsheet xmlns="${MAIN}"/>` },
        { name: 'مخفية', hidden: true, xml: sheetXml('') },
      ]),
    );
    expect(book.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['أولى', false],
      ['مخفية', true],
    ]);
    expect(await rowsOf(book, 0)).toEqual([{ number: 1, cells: ['', 'x'] }]);
    expect(await rowsOf(book, 1)).toEqual([]);
    await expect(rowsOf(book, 5)).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });

  it('refuses macro-enabled workbooks', () => {
    const plain = [{ name: 'S', xml: sheetXml('') }];
    expect(() =>
      XlsxWorkbook.open(workbook(plain, { files: { 'xl/vbaProject.bin': 'x' } })),
    ).toThrow(expect.objectContaining({ code: 'FILE_MACROS' }));
    expect(() =>
      XlsxWorkbook.open(
        workbook(plain, {
          files: {
            '[Content_Types].xml':
              '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>',
          },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'FILE_MACROS' }));
  });

  it('refuses a value beyond column 200, more than 50 sheets, a DOCTYPE, broken XML', async () => {
    const wide = sheetXml('<row r="1"><c r="GS1" t="inlineStr"><is><t>x</t></is></c></row>');
    await expect(rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml: wide }])))).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_TOO_MANY_COLUMNS' }),
    );
    const many = Array.from({ length: 51 }, (_v, i) => ({
      name: `S${String(i)}`,
      xml: sheetXml(''),
    }));
    expect(() => XlsxWorkbook.open(workbook(many))).toThrow(
      expect.objectContaining({ code: 'FILE_TOO_MANY_SHEETS' }),
    );
    const doctype = `<!DOCTYPE x [<!ENTITY a "aaaa">]>${sheetXml('<row r="1"><c t="inlineStr"><is><t>&a;</t></is></c></row>')}`;
    await expect(
      rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml: doctype }]))),
    ).rejects.toThrow(expect.objectContaining({ code: 'FILE_UNREADABLE' }));
    await expect(
      rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml: '<worksheet><sheetData><row>' }]))),
    ).rejects.toThrow(expect.objectContaining({ code: 'FILE_UNREADABLE' }));
  });

  it('refuses text runs longer than the parser may buffer, and over-long cells', async () => {
    const long = sheetXml(
      `<row r="1"><c t="inlineStr"><is><t>${'x'.repeat(MAX_XML_GAP + 10)}</t></is></c></row>`,
    );
    await expect(rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml: long }])))).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    const cell = sheetXml(`<row r="1"><c><v>${'1'.repeat(40_000)}</v></c></row>`);
    await expect(rowsOf(XlsxWorkbook.open(workbook([{ name: 'S', xml: cell }])))).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });

  it('refuses files that are not workbooks', () => {
    expect(() => XlsxWorkbook.open(new Uint8Array([1, 2, 3]))).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    expect(() => XlsxWorkbook.open(zipSync({ 'a.txt': strToU8('x') }))).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    const good = workbook([{ name: 'S', xml: sheetXml('') }]);
    expect(() => XlsxWorkbook.open(good.subarray(0, good.length - 30))).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });
});

describe('XlsxWorkbook: bounded work (security review H1)', () => {
  const LIMITS = { maxRows: 10_000, maxColumns: 200, maxCellChars: 32_767 };
  const row = (r: number) =>
    `<row r="${String(r)}"><c r="A${String(r)}" t="inlineStr"><is><t>${'x'.repeat(40)}</t></is></c></row>`;
  const bigSheet = (rows: number) =>
    sheetXml(Array.from({ length: rows }, (_v, i) => row(i + 1)).join(''));

  it('refuses two sheets in one part (each would read the same huge part again)', () => {
    const bytes = workbook([{ name: 'A', xml: sheetXml('') }], {
      files: {
        'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId1"/></sheets></workbook>`,
      },
    });
    expect(() => XlsxWorkbook.open(bytes)).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });

  it('counts every part read from one opening against one budget', async () => {
    const xml = bigSheet(1000); // ≈ 80 KB each
    const bytes = workbook([
      { name: 'A', xml },
      { name: 'B', xml },
    ]);
    const book = XlsxWorkbook.open(bytes, { ...LIMITS, maxUnpackedBytes: 120_000 });
    expect(await rowsOf(book, 0)).toHaveLength(1000);
    await expect(rowsOf(book, 1)).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    // Reading the same sheet again spends the budget again.
    const again = XlsxWorkbook.open(bytes, { ...LIMITS, maxUnpackedBytes: 120_000 });
    await rowsOf(again, 0);
    await expect(rowsOf(again, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });

  // 9,000 cells read and checked: about 0.5 s alone, 1 s under coverage instrumentation — and 7 s when the
  // whole monorepo's coverage runs on an oversubscribed machine (load 20 on 4 cores), past vitest's default
  // 5 s. The same budget as the event-loop test below; what is tested is the cells' values, not the time.
  it(
    'keeps a padded shared string short once, however many cells use it (security review, Low 1)',
    {
      timeout: 20_000,
    },
    async () => {
      const padded = `${' '.repeat(20_000)}نورة${'x'.repeat(12_000)}`; // 32,004 characters, under the cell limit
      const blank = ' '.repeat(32_000);
      const rows = Array.from(
        { length: 3000 },
        (_v, i) =>
          `<row r="${String(i + 1)}"><c r="A${String(i + 1)}" t="s"><v>0</v></c><c r="B${String(i + 1)}" t="s"><v>1</v></c><c r="C${String(i + 1)}" t="s"><v>2</v></c></row>`,
      );
      const bytes = workbook([{ name: 'A', xml: sheetXml(rows.join('')) }], {
        sharedStrings: `<sst xmlns="${MAIN}"><si><t xml:space="preserve">${padded}</t></si><si><t xml:space="preserve">${blank}</t></si><si><t>عادي</t></si></sst>`,
      });
      const read = await rowsOf(XlsxWorkbook.open(bytes));
      expect(read).toHaveLength(3000);
      for (const row of read) {
        // From the first visible character, 501 kept: still "too long" for every field (500).
        expect(row.cells[0]).toBe(`نورة${'x'.repeat(497)}`);
        expect(row.cells[1]).toBe(''); // blank, worked out once
        expect(row.cells[2]).toBe('عادي'); // short strings unchanged
      }
      expect(keptSharedString(' '.repeat(600))).toBe('');
      expect(keptSharedString(`  ${'y'.repeat(499)}`)).toBe(`  ${'y'.repeat(499)}`);
      expect(keptSharedString('z'.repeat(SHARED_STRING_KEEP + 10))).toHaveLength(
        SHARED_STRING_KEEP,
      );
      // Over the cell limit is still refused (the whole string is checked as it is read).
      const over = workbook(
        [{ name: 'A', xml: sheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
        { sharedStrings: `<sst xmlns="${MAIN}"><si><t>${'w'.repeat(32_768)}</t></si></sst>` },
      );
      await expect(rowsOf(XlsxWorkbook.open(over))).rejects.toThrow(
        expect.objectContaining({ code: 'FILE_UNREADABLE' }),
      );
    },
  );

  it('counts the shared strings against the budget too', async () => {
    const strings = Array.from(
      { length: 5000 },
      (_v, i) => `<si><t>${'s'.repeat(30)}${String(i)}</t></si>`,
    );
    const bytes = workbook(
      [{ name: 'A', xml: sheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
      { sharedStrings: `<sst xmlns="${MAIN}">${strings.join('')}</sst>` },
    );
    await expect(
      rowsOf(XlsxWorkbook.open(bytes, { ...LIMITS, maxUnpackedBytes: 100_000 })),
    ).rejects.toThrow(expect.objectContaining({ code: 'FILE_UNREADABLE' }));
    expect(await rowsOf(XlsxWorkbook.open(bytes))).toHaveLength(1);
  });

  // ≈ 1.5 MB of sheet XML: the reader yields after each megabyte, so the event loop runs before the
  // last rows. (A 3 MB sheet timed out under coverage instrumentation on a loaded machine; the yield is
  // what is tested, not the size.)
  it('lets the event loop run while it reads a large sheet', { timeout: 20_000 }, async () => {
    const rows = 20_000;
    const book = XlsxWorkbook.open(workbook([{ name: 'A', xml: bigSheet(rows) }]));
    const seen = { ran: false, duringRead: false };
    setImmediate(() => {
      seen.ran = true;
    });
    let count = 0;
    for await (const _row of book.rows(0)) {
      count += 1;
      if (seen.ran && count < rows) seen.duringRead = true;
    }
    expect(count).toBe(rows);
    expect(seen.duringRead).toBe(true);
  });
});

describe('ZipArchive', () => {
  it('stops inflating at the limit (ZIP bomb)', () => {
    // 600 KB of zeros compress to well under 1 KB: a bomb in miniature (a 5 MB one made the test slow
    // under coverage instrumentation); the limit is what is tested, not the size.
    const bytes = zipSync({ 'big.xml': new Uint8Array(600_000) }, { level: 6 });
    expect(bytes.length).toBeLessThan(2_000);
    const zip = new ZipArchive(bytes);
    expect(() => [...zip.chunks('big.xml', 100_000)]).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    expect([...zip.chunks('big.xml', 600_000)].reduce((n, c) => n + c.length, 0)).toBe(600_000);
  });

  it('reads stored entries and names without case or leading slash', () => {
    const zip = new ZipArchive(zipSync({ 'Dir/A.xml': strToU8('hello') }, { level: 0 }));
    expect(zip.names()).toEqual(['Dir/A.xml']);
    expect(zip.has('/dir/a.xml')).toBe(true);
    expect(zip.text('dir/a.xml', 10)).toBe('hello');
    expect(() => zip.text('dir/a.xml', 3)).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
    expect(() => zip.text('missing', 3)).toThrow(
      expect.objectContaining({ code: 'FILE_UNREADABLE' }),
    );
  });

  it('treats an encrypted entry as a protected file', () => {
    const bytes = zipSync({ 'a.xml': strToU8('x') }, { level: 0 });
    const copy = new Uint8Array(bytes);
    // The central directory entry's flags (bit 0: encrypted).
    for (let at = copy.length - 22; at >= 0; at -= 1) {
      if (
        copy[at] === 0x50 &&
        copy[at + 1] === 0x4b &&
        copy[at + 2] === 0x01 &&
        copy[at + 3] === 0x02
      ) {
        copy[at + 8] = 1;
        break;
      }
    }
    expect(() => new ZipArchive(copy)).toThrow(expect.objectContaining({ code: 'FILE_PROTECTED' }));
  });
});

describe('XLSX helpers', () => {
  it('knows date formats', () => {
    for (const code of ['yyyy-mm-dd', 'd/m/yy', 'mmm yyyy', '[$-409]dd mmmm', 'm/d']) {
      expect(isDateFormat(code), code).toBe(true);
    }
    for (const code of [
      '0.00',
      '"EMP"0',
      'h:mm',
      '[h]:mm:ss',
      '#,##0;[Red]-#,##0',
      '\\d0',
      'mm:ss',
    ]) {
      expect(isDateFormat(code), code).toBe(false);
    }
  });

  it('converts serials, column letters, numbers and relationship targets', () => {
    expect(serialToIsoDate(1, false)).toBe('1900-01-01');
    expect(serialToIsoDate(59, false)).toBe('1900-02-28');
    expect(serialToIsoDate(60, false)).toBe('1900-02-29');
    expect(serialToIsoDate(61, false)).toBe('1900-03-01');
    expect(serialToIsoDate(45354.75, false)).toBe('2024-03-03');
    expect(serialToIsoDate(0, false)).toBeNull();
    expect(serialToIsoDate(Number.NaN, false)).toBeNull();
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('AB12')).toBe(27);
    expect(columnIndex('xfd1')).toBe(16383);
    expect(columnIndex('12')).toBe(-1);
    expect(columnIndex('ABCD1')).toBe(-1);
    expect(numberText('551234567')).toBe('551234567');
    expect(numberText('1.5E+3')).toBe('1500');
    expect(numberText(' x ')).toBe('x');
    expect(resolveTarget('xl', 'worksheets/a.xml')).toBe('xl/worksheets/a.xml');
    expect(resolveTarget('xl/worksheets', '../sharedStrings.xml')).toBe('xl/sharedstrings.xml');
    expect(resolveTarget('xl', '/xl/Styles.xml')).toBe('xl/styles.xml');
    expect(resolveTarget('', './xl/workbook.xml')).toBe('xl/workbook.xml');
  });
});

describe('writeXlsx', () => {
  it('writes sheets the reader reads back: text, RTL, widths, formats, lists', async () => {
    const bytes = writeXlsx([
      {
        name: 'المستخدمون',
        rightToLeft: true,
        freezeHeader: true,
        columns: [{ width: 30, format: 'text' }, { width: 14, format: 'date' }, { width: 20 }],
        rows: [
          ['البريد', 'تاريخ التعيين', 'اللغة'],
          ['=1+1 & <b>', '', 'English'],
        ],
        validations: [
          { column: 2, firstRow: 2, lastRow: 10001, list: '"العربية,English"' },
          { column: 0, firstRow: 2, lastRow: 10001, list: `${sheetReference("Li'sts")}!$A$2:$A$3` },
        ],
      },
      {
        name: "Li'sts",
        rightToLeft: false,
        columns: [{ width: 10, format: 'wrap' }],
        rows: [['x'], ['y\u0001z']],
      },
    ]);
    const book = XlsxWorkbook.open(bytes);
    expect(book.sheets.map((s) => s.name)).toEqual(['المستخدمون', "Li'sts"]);
    expect(await rowsOf(book, 0)).toEqual([
      { number: 1, cells: ['البريد', 'تاريخ التعيين', 'اللغة'] },
      { number: 2, cells: ['=1+1 & <b>', '', 'English'] },
    ]);
    expect((await rowsOf(book, 1)).map((r) => r.cells)).toEqual([['x'], ['yz']]);
    const zip = new ZipArchive(bytes);
    const sheet = zip.text('xl/worksheets/sheet1.xml', 1_000_000);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<formula1>&quot;العربية,English&quot;</formula1>');
    expect(sheet).toContain('sqref="A2:A10001"');
    expect(sheet).not.toContain('<f>');
    // The same template downloads as the same bytes.
    expect(writeXlsx([{ name: 'a', rightToLeft: false, columns: [], rows: [['x']] }])).toEqual(
      writeXlsx([{ name: 'a', rightToLeft: false, columns: [], rows: [['x']] }]),
    );
    expect(() => writeXlsx([])).toThrow();
  });

  it('escapes XML and names columns', () => {
    expect(xmlText('a&b<c>"d\'\u0000￾')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(25)).toBe('Z');
    expect(columnLetters(26)).toBe('AA');
    expect(columnLetters(16383)).toBe('XFD');
  });
});
