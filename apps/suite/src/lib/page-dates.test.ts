import { describe, expect, it } from 'vitest';
import { pageDates } from './page-dates';

const AT = new Date('2026-10-14T11:05:00Z');
const plain = (text: string) => text.replace(/[\u202f\u00a0]/gu, ' ');

describe('pageDates (FR-SCH-07, T-M2-22)', () => {
  it('formats as the organization shows dates, in its time zone', () => {
    const regional = { dateDisplay: 'dual', timeZone: 'Asia/Riyadh', defaultLocale: 'ar' } as const;
    expect(plain(pageDates('en', { regional }).dateTime(AT))).toBe(
      'Oct 14, 2026, 2:05 PM · Jumada I 3, 1448 AH',
    );
    expect(pageDates('ar', { regional: { ...regional, dateDisplay: 'hijri' } }).date(AT)).toBe(
      '3 جمادى الأولى 1448 هـ',
    );
    expect(
      plain(
        pageDates('en', {
          regional: { ...regional, dateDisplay: 'gregorian', timeZone: 'UTC' },
        }).dateTime(AT),
      ),
    ).toBe('Oct 14, 2026, 11:05 AM');
  });
});
