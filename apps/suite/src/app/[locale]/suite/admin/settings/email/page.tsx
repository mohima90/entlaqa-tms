import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  Alert,
  Icon,
  ListCard,
  ListCards,
  PageHeader,
  buttonClasses,
  tableClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmailIntegrationForm } from '../../../../../../components/email/email-integration-form';
import { EmailTestLine } from '../../../../../../components/email/email-test-line';
import { RefreshWhileTesting } from '../../../../../../components/email/sender-status';
import { NotInPlan } from '../../../../../../components/plan/not-in-plan';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { authErrorTexts } from '../../../../../../lib/auth-texts';
import { emailIntegrationQuery } from '../../../../../../lib/email-queries';
import { reasonText } from '../../../../../../lib/email-reasons';
import { templateKey } from '../../../../../../lib/email-settings-form';
import { flattenTexts } from '../../../../../../lib/flatten-texts';
import { pageDates } from '../../../../../../lib/page-dates';
import { pageStepUp, sessionEmail, settingsCommonTexts } from '../../../../../../lib/settings-page';
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
 * shown. Direction C (redesign package 2, PO 21 Oct 2026): «Who sends your e-mails», the set-up in three
 * numbered steps (the test inline, «Use my provider» in the test step), toasts, and the delivery errors
 * as a table on a desktop and cards on a phone.
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
  } else if (!context.navigation.emailIntegration) {
    // Not in the organization's plan (WP-ADM-06): nothing to show or change.
    content = <NotInPlan locale={locale} />;
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
          <Alert
            tone="danger"
            data-testid="email-integration-load-failed"
            action={
              <a
                href={`/${locale}${PATH}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="sync" />
                {(await getTranslations({ locale, namespace: 'common' }))('tryAgain')}
              </a>
            }
          >
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
        breadcrumbs={[
          { label: t('integration.breadcrumbSection') },
          { label: t('integration.title') },
        ]}
        breadcrumbsLabel={t('integration.breadcrumbLabel')}
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
    <div className="flex max-w-5xl flex-col gap-5">
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
        ownEmail={(await sessionEmail()) ?? ''}
        verifiedLabel={
          sender?.status === 'verified' && sender.verifiedAt
            ? t('integration.verified', { date: dates.dateTime(sender.verifiedAt) })
            : null
        }
        testLine={
          sender?.test ? (
            <EmailTestLine test={sender.test} texts={texts} format={(d) => dates.dateTime(d)} />
          ) : null
        }
        texts={texts}
        common={await settingsCommonTexts(locale)}
        errors={await authErrorTexts(locale)}
        stepUp={await pageStepUp(locale, PATH, 'platform.tenant.manage')}
      />
      <section
        aria-labelledby="email-failures"
        className="overflow-hidden rounded-xl border border-border bg-surface"
      >
        <div className="flex items-start gap-3 p-5 sm:p-6">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text"
          >
            <Icon name="error" />
          </span>
          <div>
            <h2 id="email-failures" className="m-0 text-lg font-bold">
              {t('integration.failuresTitle')}
            </h2>
            <p className="m-0 text-sm text-text-muted">{t('integration.failuresIntro')}</p>
          </div>
        </div>
        {failures.length === 0 ? (
          <p
            className="m-0 flex items-center gap-2 px-5 pb-6 font-semibold text-success sm:px-6"
            data-testid="email-failures-empty"
          >
            <Icon name="success" />
            {t('integration.failuresEmpty')}
          </p>
        ) : (
          <>
            <div
              className={`${tableClasses.wrapper} hidden border-t border-border md:block`}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
              tabIndex={0}
              role="region"
              aria-label={t('integration.failuresCaption')}
            >
              <table className={tableClasses.table} data-testid="email-failures">
                <caption className="sr-only">{t('integration.failuresCaption')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    {(
                      ['colWhen', 'colEmail', 'colRecipient', 'colSender', 'colReason'] as const
                    ).map((key) => (
                      <th key={key} scope="col" className={tableClasses.head}>
                        {t(`integration.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {failures.map((failure, index) => (
                    <tr
                      key={`${failure.failedAt.toISOString()}-${String(index)}`}
                      className={tableClasses.row}
                    >
                      <td className={tableClasses.cell}>{dates.dateTime(failure.failedAt)}</td>
                      <td className={tableClasses.cell}>
                        {t(`templates.${templateKey(failure.template)}`)}
                      </td>
                      <td className={tableClasses.cell}>
                        <bdi dir="ltr">{failure.recipientDomain ?? '—'}</bdi>
                      </td>
                      <td className={tableClasses.cell}>
                        {t(`senders.${failure.sender ?? 'unknown'}`)}
                      </td>
                      <td className={tableClasses.cell}>{reasonText(failure.errorCode, texts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListCards className="border-t border-border" data-testid="email-failures-cards">
              {failures.map((failure, index) => (
                <ListCard
                  key={`${failure.failedAt.toISOString()}-${String(index)}`}
                  title={t(`templates.${templateKey(failure.template)}`)}
                  detail={
                    <>
                      {dates.dateTime(failure.failedAt)} ·{' '}
                      <bdi dir="ltr">{failure.recipientDomain ?? '—'}</bdi> ·{' '}
                      {t(`senders.${failure.sender ?? 'unknown'}`)}
                    </>
                  }
                  status={
                    <span className="text-sm text-danger">
                      {reasonText(failure.errorCode, texts)}
                    </span>
                  }
                />
              ))}
            </ListCards>
          </>
        )}
      </section>
    </div>
  );
}
