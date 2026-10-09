import 'server-only';
import type { MySignInSession, SignInSession } from '@jadarat/platform-db';
import { getMessages } from '@jadarat/platform-i18n';
import type { AppLocale } from '@jadarat/platform-i18n';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { SessionRow } from '../components/sessions/sessions-table';
import { describeUserAgent } from './user-agent';
import { localizedName } from './users-view';

/** The sessions table's rows: the browser described, dates formatted (T-M2-10, screen 3). */
export async function sessionRows(
  locale: AppLocale,
  sessions: readonly (SignInSession | MySignInSession)[],
): Promise<SessionRow[]> {
  const t = await getTranslations({ locale, namespace: 'sessions' });
  const format = await getFormatter({ locale });
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
      started: format.dateTime(session.startedAt, 'dateTime'),
      lastActive: format.dateTime(session.lastActiveAt, 'dateTime'),
      isCurrent: session.isCurrent,
      withCode: session.withCode,
    };
  });
}

/** The sessions table's texts (raw: the table fills `{device}` itself). */
export function sessionLabels(locale: AppLocale): Readonly<Record<string, string>> {
  return getMessages(locale).sessions;
}
