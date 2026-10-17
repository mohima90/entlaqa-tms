import { getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformEmailSettingsForRequest } from '@jadarat/platform-identity/auth';
import { Alert, Badge, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { RefreshWhileTesting } from '../../../../../components/email/sender-status';
import { PlatformEmailForm } from '../../../../../components/platform/platform-email-form';
import { PlatformShell } from '../../../../../components/platform/platform-shell';
import { authErrorTexts } from '../../../../../lib/auth-texts';
import { getConfigStatus } from '../../../../../lib/config-status';
import { providerLabel } from '../../../../../lib/email-settings-form';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { platformErrorTexts } from '../../../../../lib/platform-texts';
import { EmailTestLine } from '../../../../../components/email/email-test-line';

const PATH = '/platform/settings/email';

/**
 * Platform settings → Email «مرسِل البريد» / Email sender (WP-ADM-01; FR-ADM-17, FR-NTF-11; Kawadir's
 * (admin)/settings/email, Jadarat palette): the current status first — working (a test went out), saved but
 * unproven, or not set up — with the messages waiting for a sender (warning), then the configure card.
 * Deny by default, on the server, before anything renders: a Super Admin's verified session — everyone else
 * gets 404 (platform-identity platform-email-console.ts). The secrets are never shown: not even to the
 * Super Admin.
 */
export default async function PlatformEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!getConfigStatus().auth || !getConfigStatus().database) notFound();
  const result = await loadPlatformEmailSettingsForRequest();
  if (!result.ok) notFound();
  const view = result.value;
  const t = await getTranslations({ locale, namespace: 'emailSettings' });
  const texts = flattenTexts(getMessages(locale).emailSettings);
  const dates = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  });
  const sender = view.sender;
  const testing = sender?.test?.status === 'queued' || sender?.test?.status === 'sending';

  return (
    <PlatformShell locale={locale} path={PATH}>
      <RefreshWhileTesting active={testing} />
      <div className="flex max-w-3xl flex-col gap-6">
        <div>
          <p className="m-0 text-sm text-text-muted">{t('platform.breadcrumb')}</p>
          <h1 className="mb-1 mt-0 text-2xl font-bold">{t('platform.title')}</h1>
          <p className="m-0 text-text-muted">{t('platform.subtitle')}</p>
        </div>

        {!view.available ? (
          <Alert tone="warning" data-testid="platform-email-unavailable">
            {t('platform.notAvailable')}
          </Alert>
        ) : !view.keyReady ? (
          <Alert tone="warning" data-testid="platform-email-key-missing">
            {t('platform.keyMissing')}
          </Alert>
        ) : null}

        {view.waitingCount > 0 ? (
          <Alert tone="warning" data-testid="platform-email-waiting">
            {t('platform.waiting', {
              count: view.waitingCount,
              date: view.oldestWaitingAt ? dates.format(view.oldestWaitingAt) : '',
            })}
          </Alert>
        ) : null}

        <Card
          aria-labelledby="platform-email-status"
          titleId="platform-email-status"
          title={t('platform.statusTitle')}
          icon="mail"
          className="flex flex-col gap-3 *:first:mb-0"
        >
          <div className="flex flex-wrap items-center gap-2" data-testid="platform-email-status">
            {sender?.status === 'verified' ? (
              <>
                <Badge tone="success">
                  {t('integration.verified', {
                    date: sender.verifiedAt ? dates.format(sender.verifiedAt) : '',
                  })}
                </Badge>
                <p className="m-0">
                  {t('platform.statusVerified', {
                    address: sender.fromAddress,
                    provider: providerLabel(sender.provider),
                  })}
                </p>
              </>
            ) : sender ? (
              <>
                <Badge tone="warning">{t('integration.notVerified')}</Badge>
                <p className="m-0">{t('platform.statusUnverified')}</p>
              </>
            ) : (
              <>
                <Badge tone="neutral">{t('integration.notVerified')}</Badge>
                <p className="m-0">{t('platform.statusNone')}</p>
              </>
            )}
          </div>
          {sender?.test ? (
            <EmailTestLine test={sender.test} texts={texts} format={(d) => dates.format(d)} />
          ) : null}
        </Card>

        {view.available ? (
          <PlatformEmailForm
            saved={
              sender
                ? {
                    provider: sender.provider,
                    options: sender.options,
                    credentialsCurrent: sender.credentialsCurrent,
                    fromName: sender.fromName,
                    fromAddress: sender.fromAddress,
                    version: sender.version,
                  }
                : null
            }
            keyReady={view.keyReady}
            texts={texts}
            errors={{ ...(await authErrorTexts(locale)), ...(await platformErrorTexts(locale)) }}
          />
        ) : null}
      </div>
    </PlatformShell>
  );
}
