import { describe, expect, it } from 'vitest';
import { DETECTION_HEAD_BYTES, detectType, sniffText } from './detect';
import { CFB, EXE, PNG, bytes, workbook } from './test-fixtures';
import { XLSX } from './purposes';

const utf8 = (text: string) => new TextEncoder().encode(text);
/** The byte-order mark, built (never literally in the source). */
const BOM = String.fromCodePoint(0xfeff);

describe('detectType', () => {
  it('recognizes binary formats by their signature, whatever the name', async () => {
    expect(await detectType(PNG, true)).toBe('image/png');
    expect(
      await detectType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46), true),
    ).toBe('image/jpeg');
    expect(await detectType(utf8('%PDF-1.7\n%âãÏÓ\n'), true)).toBe('application/pdf');
    expect(await detectType(EXE, true)).toBe('application/x-msdownload');
    expect(await detectType(CFB, true)).toBe('application/x-cfb');
  });

  it('tells XLSX from a macro-enabled workbook (XLSM)', async () => {
    expect(await detectType(workbook(), true)).toBe(XLSX);
    expect(await detectType(workbook(true), true)).toBe(
      'application/vnd.ms-excel.sheet.macroenabled.12',
    );
  });

  it('falls back to strict text sniffing; nothing for an empty head', async () => {
    expect(await detectType(utf8('email,first_name\na@b.c,سارة\n'), true)).toBe('text/csv');
    expect(await detectType(utf8('hello'), true)).toBe('text/plain');
    expect(await detectType(new Uint8Array(0), true)).toBeNull();
    expect(DETECTION_HEAD_BYTES).toBe(1024 * 1024);
  });
});

describe('sniffText', () => {
  it('accepts UTF-8 with or without BOM; CSV by a separator on the first line', () => {
    expect(sniffText(utf8(`${BOM}البريد;الاسم\r\nx;y`), true)).toBe('text/csv');
    expect(sniffText(utf8('a\tb\n'), true)).toBe('text/csv');
    expect(sniffText(utf8('\n\nname,email\n'), true)).toBe('text/csv');
    expect(sniffText(utf8('just words\nwith, a comma later'), true)).toBe('text/plain');
  });

  it('refuses other encodings, control characters and emptiness', () => {
    // Windows-1256 Arabic: not UTF-8.
    expect(sniffText(bytes(0xc7, 0xe1, 0xc8, 0xd1, 0xed, 0xcf, 0x2c, 0x41), true)).toBeNull();
    expect(sniffText(utf8('a,b\u0000c'), true)).toBeNull();
    expect(sniffText(utf8('a,b\u007f'), true)).toBeNull();
    expect(sniffText(utf8(BOM), true)).toBeNull();
  });

  it('accepts a head cut inside a multi-byte character, unless the file ends there', () => {
    const cut = utf8('a,b\nسارة').subarray(0, 7);
    expect(sniffText(cut, false)).toBe('text/csv');
    expect(sniffText(cut, true)).toBeNull();
  });
});
