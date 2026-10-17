import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Card, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmailIntegrationForm } from '../../../../../../components/email/email-integration-form';
import { EmailTestLine } from '../../../../../../components/email/email-test-line';
import { RefreshWhileTesting } from '../../../../../../components/email/sender-status';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { authErrorTexts } from '../../../../../../lib/auth-texts';
import { emailIntegrationQuery } from '../../../../../../lib/email-queries';
import { reasonText } from '../../../../../../lib/email-reasons';
import { templateKey } from '../../../../../../lib/email-settings-form';
import { flattenTexts } from '../../../../../../lib/flatten-texts';
import { pageDates } from '../../../../../../lib/page-dates';
import { type SuiteContext, getSuiteContext } from '../../../../../../lib/suite-context';
import { SUITE_PATHS } from '../../../../../../lib/suite-navigation';

const PATH = SUITE_PATHS.emailIntegration;

/**
 * Settings → Email integration «تكامل البريد الإلكتروني» (WP-ADM-01; FR-NTF-11, FR-NTF-02 sending; Kawadir's
 * org Settings → Email, the provider part, Jadarat palette). The organization's e-mails go out through the
 * platform sender (with its name) by default, or through its own provider once configured, tested and
 * enabled; the Organization Admin can switch back at any time. Waiting messages and the latest delivery
 * errors (the recipient's domain only) are shown here — no automatic switch to another sender (PO, 17 Oct
 * 2026). Members with platform.tenant.read see it read-only; everyone else is refused. The secrets are never
 * shown.
 */
export default async function EmailIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'emailSettings' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="email-integration-not-configured">
        {t('integration.notConfigured')}
      </Alert>
    );
  } else {
    const result = await emailIntegrationQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND' ? (
          <Alert tone="warning" data-testid="email-integration-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {errors('internalError', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      content = <Integration locale={locale} view={result.value} context={context} />;
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="emailIntegration" path={PATH}>
      <PageHeader
        eyebrow={
          <nav aria-label={t('integration.breadcrumbLabel')}>
            <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              <li>{t('integration.breadcrumbSection')}</li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{t('integration.title')}</li>
            </ol>
          </nav>
        }
        title={t('integration.title')}
        description={t('integration.intro')}
      />
      {content}
    </SuiteShell>
  );
}

async function Integration({
  locale,
  view,
  context,
}: {
  locale: AppLocale;
  view: Extract<Awaited<ReturnType<typeof emailIntegrationQuery>>, { ok: true }>['value'];
  context: SuiteContext;
}) {
  const t = await getTranslations({ locale, namespace: 'emailSettings' });
  const texts = flattenTexts(getMessages(locale).emailSettings);
  const dates = pageDates(locale, context);
  const { settings, failures, editAccess } = view;
  if (!settings.available) {
    return (
      <Alert tone="warning" data-testid="email-integration-unavailable">
        {t('integration.notAvailable')}
      </Alert>
    );
  }
  const sender = settings.sender;
  const testing = sender?.test?.status === 'queued' || sender?.test?.status === 'sending';
  const organizationName = context.organizationName ?? '';
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <RefreshWhileTesting active={testing} />
      {editAccess === 'denied' ? (
        <Alert tone="info" data-testid="email-integration-read-only">
          {t('integration.readOnly')}
        </Alert>
      ) : null}
      {!settings.keyReady && editAccess === 'allowed' ? (
        <Alert tone="warning" data-testid="email-integration-key-missing">
          {t('integration.keyMissing')}
        </Alert>
      ) : null}
      {settings.waitingCount > 0 ? (
        <Alert tone="warning" data-testid="email-integration-waiting">
          {t('integration.waiting', { count: settings.waitingCount })}
        </Alert>
      ) : null}
      {sender?.test ? (
        <EmailTestLine test={sender.test} texts={texts} format={(d) => dates.dateTime(d)} />
      ) : null}
      <EmailIntegrationForm
        saved={
          sender
            ? {
                provider: sender.provider,
                options: sender.options,
                credentialsCurrent: sender.credentialsCurrent,
                fromName: sender.fromName,
                fromAddress: sender.fromAddress,
                replyTo: sender.replyTo,
                enabled: sender.enabled,
                verified: sender.status === 'verified',
                version: sender.version,
              }
            : null
        }
        platformSenderVerified={settings.platformSenderVerified}
        keyReady={settings.keyReady}
        editable={editAccess === 'allowed'}
        organizationName={organizationName}
        texts={texts}
        errors={await authErrorTexts(locale)}
      />
      <Card
        aria-labelledby="email-failures"
        titleId="email-failures"
        title={t('integration.failuresTitle')}
        description={t('integration.failuresIntro')}
        icon="mail"
        className="flex flex-col gap-4 overflow-x-auto *:first:mb-0"
      >
        {failures.length === 0 ? (
          <p className="m-0 text-text-muted" data-testid="email-failures-empty">
            {t('integration.failuresEmpty')}
          </p>
        ) : (
          <table className="w-full border-collapse text-start text-sm" data-testid="email-failures">
            <caption className="sr-only">{t('integration.failuresCaption')}</caption>
            <thead className="bg-surface-sunken">
              <tr>
                {(['colWhen', 'colEmail', 'colRecipient', 'colSender', 'colReason'] as const).map(
                  (key) => (
                    <th
                      key={key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 text-start font-semibold"
                    >
                      {t(`integration.${key}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {failures.map((failure, index) => (
                <tr
                  key={`${failure.failedAt.toISOString()}-${String(index)}`}
                  className="border-t border-border align-top"
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    {dates.dateTime(failure.failedAt)}
                  </td>
                  <td className="px-3 py-2">{t(`templates.${templateKey(failure.template)}`)}</td>
                  <td className="px-3 py-2">
                    <bdi dir="ltr">{failure.recipientDomain ?? '—'}</bdi>
                  </td>
                  <td className="px-3 py-2">{t(`senders.${failure.sender ?? 'unknown'}`)}</td>
                  <td className="px-3 py-2">{reasonText(failure.errorCode, texts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
