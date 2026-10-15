import {
  type AppLocale,
  type DisplayDateFormatter,
  displayDateFormatter,
} from '@jadarat/platform-i18n';
import type { SuiteContext } from './suite-context';

/**
 * The dates of a suite page as the organization shows them (FR-SCH-07; T-M2-22): Gregorian, Hijri
 * (Umm al-Qura) or both, in the organization's time zone — users list, profiles, sessions, "last changed".
 * Built on the pure formatter of platform-i18n (formatDisplayDate).
 */
export function pageDates(
  locale: AppLocale,
  context: Pick<SuiteContext, 'regional'>,
): DisplayDateFormatter {
  return displayDateFormatter(locale, context.regional.dateDisplay, context.regional.timeZone);
}
