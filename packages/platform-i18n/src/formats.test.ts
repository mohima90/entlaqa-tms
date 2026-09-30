import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, DEFAULT_NUMBERING_SYSTEM, formats, formattingLocale } from './index';

const instant = new Date('2026-10-05T09:30:00Z');

describe('explicit numbering system and calendar (ADR 0007 §1, §5)', () => {
  it('pins numberingSystem (and calendar for dates) on every named format', () => {
    for (const options of Object.values(formats.dateTime)) {
      expect(options.numberingSystem).toBe(DEFAULT_NUMBERING_SYSTEM);
      expect(options.calendar).toBe(DEFAULT_CALENDAR);
    }
    for (const options of Object.values(formats.number)) {
      expect(options.numberingSystem).toBe(DEFAULT_NUMBERING_SYSTEM);
    }
  });

  it('Arabic formatting uses Western digits and the Gregorian calendar regardless of runtime defaults', () => {
    for (const locale of ['ar', 'ar-SA', 'ar-EG']) {
      const text = new Intl.DateTimeFormat(locale, {
        ...formats.dateTime.long,
        timeZone: 'Asia/Riyadh',
      }).format(instant);
      expect(text, locale).toMatch(/2026/);
      expect(text, locale).not.toMatch(/[٠-٩]/);
      expect(new Intl.NumberFormat(locale, formats.number.decimal).format(1234.5), locale).toMatch(
        /^1[,٬]?234[.٫]5$/,
      );
    }
  });

  it('builds BCP 47 formatting locales with explicit extensions', () => {
    expect(formattingLocale('ar')).toBe('ar-u-nu-latn-ca-gregory');
    expect(formattingLocale('en')).toBe('en-u-nu-latn-ca-gregory');
    const resolved = new Intl.DateTimeFormat(formattingLocale('ar')).resolvedOptions();
    expect(resolved.numberingSystem).toBe('latn');
    expect(resolved.calendar).toBe('gregory');
  });
});
