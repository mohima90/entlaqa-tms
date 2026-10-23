import 'server-only';
import type { RememberedBrowser } from '@jadarat/platform-db';
import { getMessages } from '@jadarat/platform-i18n';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';
import type { RememberedBrowserRow } from '../components/profile/remembered-browsers';

/**
 * My profile › Remembered browsers (WP-ADM-05): the rows with the dates as the organization shows them
 * (Gregorian / Hijri / both, its time zone), and the section's texts. The device label was stored as
 * «Chrome on Windows» (well-known names only, never a raw user agent).
 */
export async function rememberedRows(
  locale: AppLocale,
  browsers: readonly RememberedBrowser[],
  dates: DisplayDateFormatter,
): Promise<RememberedBrowserRow[]> {
  const t = await getTranslations({ locale, namespace: 'profile.remembered' });
  return browsers.map((browser) => ({
    id: browser.id,
    device: browser.label ?? t('unknownBrowser'),
    remembered: t('rememberedOn', { date: dates.dateTime(browser.createdAt) }),
    until: browser.validUntil ? dates.dateTime(browser.validUntil) : null,
    isCurrent: browser.current,
  }));
}

/** The section's texts; `count` is formatted for the number of browsers. */
export async function rememberedLabels(
  locale: AppLocale,
  count: number,
): Promise<Readonly<Record<string, string>>> {
  const t = await getTranslations({ locale, namespace: 'profile.remembered' });
  const raw = getMessages(locale).profile as unknown as { remembered: Record<string, string> };
  return { ...raw.remembered, count: t('count', { count }) };
}
