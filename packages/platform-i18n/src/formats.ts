import type { Formats } from 'next-intl';
import type { AppLocale } from './locales';

/**
 * ADR 0007 §1/§5: formatting never relies on a runtime's default numbering system or calendar for
 * `ar` (they differ between CLDR versions and regional variants: plain `ar` may produce Eastern Arabic
 * digits, `ar-SA` the Umm al-Qura calendar). Every named format pins both explicitly.
 * TODO(NFR-L10N-03, M2): Eastern Arabic digits (`arab`) per tenant default / user preference; Hijri
 * display via the dedicated Hijri formatter (ADR 0007 §6), never via the runtime default.
 */
export const DEFAULT_NUMBERING_SYSTEM = 'latn';
export const DEFAULT_CALENDAR = 'gregory';

/** BCP 47 locale with explicit Unicode extensions, for direct Intl.* use outside next-intl. */
export function formattingLocale(locale: AppLocale): string {
  return `${locale}-u-nu-${DEFAULT_NUMBERING_SYSTEM}-ca-${DEFAULT_CALENDAR}`;
}

const date = { numberingSystem: DEFAULT_NUMBERING_SYSTEM, calendar: DEFAULT_CALENDAR } as const;
const number = { numberingSystem: DEFAULT_NUMBERING_SYSTEM } as const;

/** Named next-intl formats (`format.dateTime(d, 'short')`, `{n, number, integer}` in messages). */
export const formats = {
  dateTime: {
    short: { ...date, dateStyle: 'short' },
    medium: { ...date, dateStyle: 'medium' },
    long: { ...date, dateStyle: 'long' },
    time: { ...date, timeStyle: 'short' },
    dateTime: { ...date, dateStyle: 'medium', timeStyle: 'short' },
  },
  number: {
    integer: { ...number, maximumFractionDigits: 0 },
    decimal: { ...number, maximumFractionDigits: 2 },
    percent: { ...number, style: 'percent', maximumFractionDigits: 0 },
  },
} as const satisfies Formats;
