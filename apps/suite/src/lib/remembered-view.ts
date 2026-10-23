import 'server-only';
import { describeUserAgent } from '@jadarat/platform-core';
import type { KeptSession } from '@jadarat/platform-db';
import { getMessages } from '@jadarat/platform-i18n';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';
import type { RememberedBrowserRow } from '../components/profile/remembered-browsers';

/**
 * My profile › Browsers kept signed in (WP-ADM-05): the rows with the dates as the organization shows them
 * (Gregorian / Hijri / both, its time zone). A session is described by browser and system from Auth's record of
 * the user agent (well-known names only), never shown raw.
 */
export async function rememberedRows(
  locale: AppLocale,
  sessions: readonly KeptSession[],
  dates: DisplayDateFormatter,
): Promise<RememberedBrowserRow[]> {
  const t = await getTranslations({ locale, namespace: 'profile.remembered' });
  return sessions.map((session) => {
    const device = describeUserAgent(session.userAgent);
    return {
      id: session.sessionId,
      device:
        device.browser && device.system
          ? `${device.browser} on ${device.system}`
          : (device.browser ?? device.system ?? t('unknownBrowser')),
      remembered: t('rememberedOn', { date: dates.dateTime(session.startedAt) }),
      until: dates.dateTime(session.keptUntil),
      isCurrent: session.current,
    };
  });
}

/** The section's texts; `count` is formatted for the number of kept sessions. */
export async function rememberedLabels(
  locale: AppLocale,
  count: number,
): Promise<Readonly<Record<string, string>>> {
  const t = await getTranslations({ locale, namespace: 'profile.remembered' });
  const raw = getMessages(locale).profile as unknown as { remembered: Record<string, string> };
  return { ...raw.remembered, count: t('count', { count }) };
}
