import { describe, expect, it } from 'vitest';
import { DUAL_SEPARATOR, displayDateFormatter, formatDisplayDate } from './dates';

// 14 Oct 2026, 2:05 PM in Riyadh = 3 Jumada I 1448 AH (Umm al-Qura).
const AT = new Date('2026-10-14T11:05:00Z');

/** ICU versions differ in the space before AM/PM (U+202F or a plain space): compare with plain spaces. */
function formatted(...args: Parameters<typeof formatDisplayDate>): string {
  return formatDisplayDate(...args).replace(/[\u202f\u00a0]/gu, ' ');
}

describe('formatDisplayDate (FR-SCH-07, T-M2-22)', () => {
  it('Gregorian in the organization time zone, Western digits', () => {
    expect(formatted(AT, { locale: 'en', display: 'gregorian', timeZone: 'Asia/Riyadh' })).toBe(
      'Oct 14, 2026, 2:05 PM',
    );
    expect(
      formatted(AT, { locale: 'en', display: 'gregorian', timeZone: 'Asia/Riyadh', style: 'date' }),
    ).toBe('Oct 14, 2026');
    expect(formatted(AT, { locale: 'ar', display: 'gregorian', timeZone: 'Asia/Riyadh' })).toMatch(
      /^14.\/10.\/2026، 2:05 م$/u,
    );
    // Another zone moves the time (and here the day).
    expect(
      formatted('2026-10-14T22:30:00Z', {
        locale: 'en',
        display: 'gregorian',
        timeZone: 'Asia/Dubai',
      }),
    ).toBe('Oct 15, 2026, 2:30 AM');
  });

  it('Hijri (Umm al-Qura)', () => {
    expect(
      formatted(AT, { locale: 'en', display: 'hijri', timeZone: 'Asia/Riyadh', style: 'date' }),
    ).toBe('Jumada I 3, 1448 AH');
    expect(
      formatted(AT, { locale: 'ar', display: 'hijri', timeZone: 'Asia/Riyadh', style: 'date' }),
    ).toBe('3 جمادى الأولى 1448 هـ');
    expect(formatted(AT, { locale: 'en', display: 'hijri', timeZone: 'Asia/Riyadh' })).toContain(
      '2:05 PM',
    );
    expect(
      formatted(AT, { locale: 'en', display: 'hijri', timeZone: 'Asia/Riyadh', style: 'full' }),
    ).toBe('Wednesday, Jumada I 3, 1448 AH');
    expect(formatted(AT, { locale: 'ar', display: 'hijri', timeZone: 'Asia/Riyadh' })).not.toMatch(
      /[٠-٩]/u,
    );
  });

  it('both: Gregorian first, then the Hijri date', () => {
    expect(formatted(AT, { locale: 'en', display: 'dual', timeZone: 'Asia/Riyadh' })).toBe(
      `Oct 14, 2026, 2:05 PM${DUAL_SEPARATOR}Jumada I 3, 1448 AH`,
    );
    expect(
      formatted(AT, { locale: 'en', display: 'dual', timeZone: 'Asia/Riyadh', style: 'full' }),
    ).toBe('Wednesday, October 14, 2026 · Jumada I 3, 1448 AH');
    expect(
      formatted(AT, { locale: 'ar', display: 'dual', timeZone: 'Asia/Riyadh', style: 'full' }),
    ).toBe('الأربعاء، 14 أكتوبر 2026 · 3 جمادى الأولى 1448 هـ');
  });

  it('falls back to the platform zone for an unknown zone; refuses an invalid date', () => {
    expect(formatted(AT, { locale: 'en', display: 'gregorian', timeZone: 'Nowhere/Zone' })).toBe(
      'Oct 14, 2026, 2:05 PM',
    );
    expect(() =>
      formatDisplayDate('not a date', { locale: 'en', display: 'gregorian', timeZone: 'UTC' }),
    ).toThrow(RangeError);
    expect(formatted(AT.getTime(), { locale: 'en', display: 'gregorian', timeZone: 'UTC' })).toBe(
      'Oct 14, 2026, 11:05 AM',
    );
  });

  it('binds a page formatter to the organization settings', () => {
    const f = displayDateFormatter('en', 'dual', 'Asia/Riyadh');
    const plain = (text: string) => text.replace(/[\u202f\u00a0]/gu, ' ');
    expect(f.date(AT)).toBe('Oct 14, 2026 · Jumada I 3, 1448 AH');
    expect(plain(f.dateTime(AT))).toBe('Oct 14, 2026, 2:05 PM · Jumada I 3, 1448 AH');
    expect(f.full(AT)).toBe('Wednesday, October 14, 2026 · Jumada I 3, 1448 AH');
  });
});
