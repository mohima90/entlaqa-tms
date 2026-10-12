import { strToU8, zipSync } from 'fflate';

/**
 * A minimal XLSX writer for the import template (T-M2-12, approved screen 3): sheets of plain text
 * (inline strings — never formulas), a bold header row, column widths and formats, right-to-left
 * sheets, a frozen header and drop-down lists (data validation). Nothing else.
 */
export type ColumnFormat = 'text' | 'date' | 'wrap';

export interface WriterColumn {
  /** Width in characters. */
  readonly width: number;
  /** `text`: typed values stay text (leading zeros kept); `date`: YYYY-MM-DD; `wrap`: wrapped text. */
  readonly format?: ColumnFormat;
}

export interface WriterValidation {
  /** Zero-based column. */
  readonly column: number;
  /** One-based rows, inclusive. */
  readonly firstRow: number;
  readonly lastRow: number;
  /** A range on another sheet (`'Lists'!$A$2:$A$9`) or an inline list (`"العربية,English"`). */
  readonly list: string;
}

export interface WriterSheet {
  readonly name: string;
  readonly rightToLeft: boolean;
  readonly columns: readonly WriterColumn[];
  /** The first row is the header (bold, frozen when `freezeHeader`). */
  readonly rows: readonly (readonly string[])[];
  readonly freezeHeader?: boolean;
  readonly validations?: readonly WriterValidation[];
}

/** Text as XML character data: escaped, characters XML cannot carry removed. */
export function xmlText(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default:
        out += char;
    }
  }
  return out;
}

/** Column letters (0 → A, 27 → AB). */
export function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A sheet name as written in a formula (`'القوائم'`), quotes doubled. */
export function sheetReference(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Style indexes in cellXfs below. */
const STYLE = { default: 0, header: 1, text: 2, date: 3, wrap: 4 } as const;

const STYLES = `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function styleOf(format: ColumnFormat | undefined): number {
  if (format === 'date') return STYLE.date;
  if (format === 'wrap') return STYLE.wrap;
  if (format === 'text') return STYLE.text;
  return STYLE.default;
}

function sheetXml(sheet: WriterSheet): string {
  const parts: string[] = [`${XML_HEADER}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`];
  parts.push(
    `<sheetViews><sheetView workbookViewId="0"${sheet.rightToLeft ? ' rightToLeft="1"' : ''}>`,
  );
  if (sheet.freezeHeader) {
    parts.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  }
  parts.push('</sheetView></sheetViews>');
  if (sheet.columns.length > 0) {
    parts.push('<cols>');
    sheet.columns.forEach((column, i) => {
      const style = styleOf(column.format);
      parts.push(
        `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(column.width)}" customWidth="1"${style === STYLE.default ? '' : ` style="${String(style)}"`}/>`,
      );
    });
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  sheet.rows.forEach((row, r) => {
    const number = String(r + 1);
    parts.push(`<row r="${number}">`);
    row.forEach((value, c) => {
      if (value === '') return;
      const style = r === 0 ? STYLE.header : styleOf(sheet.columns[c]?.format);
      parts.push(
        `<c r="${columnLetters(c)}${number}" t="inlineStr"${style === STYLE.default ? '' : ` s="${String(style)}"`}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`,
      );
    });
    parts.push('</row>');
  });
  parts.push('</sheetData>');
  const validations = sheet.validations ?? [];
  if (validations.length > 0) {
    parts.push(`<dataValidations count="${String(validations.length)}">`);
    for (const v of validations) {
      const col = columnLetters(v.column);
      // No error message: a value typed by hand (e.g. a department code) is accepted; the list helps.
      parts.push(
        `<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="0" sqref="${col}${String(v.firstRow)}:${col}${String(v.lastRow)}"><formula1>${xmlText(v.list)}</formula1></dataValidation>`,
      );
    }
    parts.push('</dataValidations>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

/** The workbook's bytes (ZIP). */
export function writeXlsx(sheets: readonly WriterSheet[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) throw new Error('writeXlsx: no sheets');
  const files: Record<string, Uint8Array> = {};
  const overrides = sheets
    .map(
      (_s, i) =>
        `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  files['[Content_Types].xml'] = strToU8(
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  const sheetEntries = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${xmlText(sheet.name.slice(0, 31))}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
    )
    .join('');
  const firstRtl = sheets[0]?.rightToLeft === true;
  files['xl/workbook.xml'] = strToU8(
    `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"${firstRtl ? ' rightToLeft="1"' : ''}/></bookViews><sheets>${sheetEntries}</sheets></workbook>`,
  );
  const rels = sheets
    .map(
      (_s, i) =>
        `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
    )
    .join('');
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}">${rels}<Relationship Id="rId${String(sheets.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(STYLES);
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${String(i + 1)}.xml`] = strToU8(sheetXml(sheet));
  });
  // A fixed time stamp: the same template downloads as the same bytes.
  const zipped = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
  return new Uint8Array(zipped);
}
