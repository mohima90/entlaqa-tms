import 'server-only';
import type { MySignInSession, SignInSession } from '@jadarat/platform-db';
import { getMessages } from '@jadarat/platform-i18n';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';
import type { SessionRow } from '../components/sessions/sessions-table';
import { describeUserAgent } from './user-agent';
import { localizedName } from './users-view';

/**
 * The sessions table's rows: the browser described, dates formatted (T-M2-10, screen 3) as the
 * organization shows them (T-M2-22: Gregorian / Hijri / both, its time zone).
 */
export async function sessionRows(
  locale: AppLocale,
  sessions: readonly (SignInSession | MySignInSession)[],
  dates: DisplayDateFormatter,
): Promise<SessionRow[]> {
  const t = await getTranslations({ locale, namespace: 'sessions' });
  return sessions.map((session) => {
    const { browser, system } = describeUserAgent(session.userAgent);
    const device = browser
      ? t('on', { browser, system: system ?? t('unknownSystem') })
      : t('unknownBrowser');
    const organization =
      'organization' in session && session.organization
        ? localizedName(locale, session.organization.nameAr, session.organization.nameEn)
        : null;
    return {
      sessionId: session.sessionId,
      device,
      organization,
      started: dates.dateTime(session.startedAt),
      lastActive: dates.dateTime(session.lastActiveAt),
      isCurrent: session.isCurrent,
      withCode: session.withCode,
    };
  });
}

/** The sessions table's texts (raw: the table fills `{device}` itself). */
export function sessionLabels(locale: AppLocale): Readonly<Record<string, string>> {
  return getMessages(locale).sessions;
}
