import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, downloadName, sanitizeFileName } from './names';
import { XLSX as XLSX_TYPE } from './purposes';

/** Invisible characters are built from code points: never literally in the source (Trojan Source). */
const cp = (...points: number[]) => String.fromCodePoint(...points);
const RLO = cp(0x202e);
const BOM = cp(0xfeff);

describe('sanitizeFileName', () => {
  it('keeps Arabic and ordinary names, normalized to NFC', () => {
    expect(sanitizeFileName('موظفو الرياض.csv')).toBe('موظفو الرياض.csv');
    expect(sanitizeFileName('Staff list (2026).xlsx')).toBe('Staff list (2026).xlsx');
    // e + combining acute accent (decomposed) becomes the single precomposed letter.
    const decomposed = `re${cp(0x301)}sume${cp(0x301)}.pdf`;
    expect(sanitizeFileName(decomposed)).toBe(decomposed.normalize('NFC'));
    expect(sanitizeFileName(decomposed)).toHaveLength(10);
  });

  it('removes controls, bidirectional overrides and the byte-order mark', () => {
    expect(sanitizeFileName(`photo${RLO}gpj.exe`)).toBe('photogpj.exe');
    const hidden = `${BOM}a${cp(0)}b${cp(7)}c${cp(0x9f)}d${cp(0x200f, 0x61c, 0x2066)}.csv`;
    expect(sanitizeFileName(hidden)).toBe('abcd.csv');
    expect(sanitizeFileName('line\nbreak\r\t.csv')).toBe('linebreak.csv');
  });

  it('replaces path separators and characters Windows refuses; trims dots and spaces', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('a\\b:c*d?e"f<g>h|i.csv')).toBe('a_b_c_d_e_f_g_h_i.csv');
    expect(sanitizeFileName('  .hidden.csv. ')).toBe('hidden.csv');
  });

  it('falls back to a neutral name when nothing is left', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName(' ... ')).toBe('file');
    expect(sanitizeFileName(`${RLO}${cp(0)}`)).toBe('file');
  });

  it(`shortens to ${String(MAX_NAME_LENGTH)} characters, keeping a short extension`, () => {
    const long = `${'ب'.repeat(300)}.xlsx`;
    const short = sanitizeFileName(long);
    expect(Array.from(short)).toHaveLength(MAX_NAME_LENGTH);
    expect(short.endsWith('.xlsx')).toBe(true);
    const noExtension = sanitizeFileName('x'.repeat(250));
    expect(noExtension).toHaveLength(MAX_NAME_LENGTH);
    const oddExtension = sanitizeFileName(`a.${'y'.repeat(250)}`);
    expect(oddExtension).toHaveLength(MAX_NAME_LENGTH);
    // Characters outside the BMP count once.
    expect(Array.from(sanitizeFileName(cp(0x1f600).repeat(250)))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('downloadName', () => {
  it('keeps the name when its extension names the type found by content', () => {
    expect(downloadName('موظفو الرياض.csv', 'text/csv')).toBe('موظفو الرياض.csv');
    expect(downloadName('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
  });

  it('replaces an extension the uploader chose with the one of the detected type', () => {
    expect(downloadName('payroll.hta', 'text/csv')).toBe('payroll.csv');
    expect(downloadName('update.js', 'text/csv')).toBe('update.csv');
    expect(downloadName('run.bat', 'image/png')).toBe('run.png');
    expect(downloadName('staff.csv.exe', XLSX_TYPE)).toBe('staff.csv.xlsx');
    expect(downloadName('photo.png', 'image/webp')).toBe('photo.webp');
  });

  it('adds the extension when the name has none; drops it when the type has no known one', () => {
    expect(downloadName('export', 'text/csv')).toBe('export.csv');
    expect(downloadName('evil.hta', 'text/html')).toBe('evil');
    expect(downloadName('evil.hta', null)).toBe('evil');
  });

  it('sanitizes the name again', () => {
    expect(downloadName(`photo${RLO}gpj.exe`, 'image/png')).toBe('photogpj.png');
  });
});
