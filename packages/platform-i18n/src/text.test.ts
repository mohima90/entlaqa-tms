import { describe, expect, it } from 'vitest';
import { formatHijriDate } from './hijri';
import { normalizeDigits } from './text';

const shift = (digits: string, zero: number) =>
  digits.replace(/[0-9]/g, (d) => String.fromCharCode(zero + Number(d)));
const arabicIndic = (digits: string) => shift(digits, 0x0660);
const persian = (digits: string) => shift(digits, 0x06f0);

describe('normalizeDigits', () => {
  it('turns Eastern Arabic and Persian digits into ASCII and keeps everything else', () => {
    expect(normalizeDigits(`EMP-${arabicIndic('1187')}`)).toBe('EMP-1187');
    expect(normalizeDigits(persian('0123456789'))).toBe('0123456789');
    expect(normalizeDigits(arabicIndic('0123456789'))).toBe('0123456789');
    expect(normalizeDigits('سارة 42')).toBe('سارة 42');
  });
});

describe('formatHijriDate', () => {
  it('formats a stored date in Umm al-Qura with Western digits, in Arabic and English', () => {
    expect(formatHijriDate('2024-03-03', 'ar')).toBe('22 شعبان 1445 هـ');
    expect(formatHijriDate('2024-03-03', 'en')).toMatch(/22, 1445 AH$/);
    expect(() => formatHijriDate('2024-03-03T21:00:00Z', 'ar')).toThrow(RangeError);
  });
});
