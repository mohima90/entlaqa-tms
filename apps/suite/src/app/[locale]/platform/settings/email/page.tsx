import { getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformEmailSettingsForRequest } from '@jadarat/platform-identity/auth';
import { Alert, Badge, Icon, PageHeader, Spinner, cn } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { EmailTestLine } from '../../../../../components/email/email-test-line';
import { RefreshWhileTesting } from '../../../../../components/email/sender-status';
import { PlatformEmailForm } from '../../../../../components/platform/platform-email-form';
import { PlatformShell } from '../../../../../components/platform/platform-shell';
import { authErrorTexts } from '../../../../../lib/auth-texts';
import { getConfigStatus } from '../../../../../lib/config-status';
import { providerLabel } from '../../../../../lib/email-settings-form';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { platformErrorTexts } from '../../../../../lib/platform-texts';

const PATH = '/platform/settings/email';

/**
 * Platform settings → Email «مرسِل البريد» / Email sender (WP-ADM-01; FR-ADM-17, FR-NTF-11; Kawadir's
 * (admin)/settings/email, Jadarat palette), redesign package 5: the current status first — a card with a
 * coloured edge: working (a test went out), saved but unproven, or not set up — with the messages waiting
 * for a sender (warning) and the platform sender's failed deliveries of the last 24 hours (all
 * organizations, a count only), then «Configure» as three numbered steps (the latest test line sits in
 * step 3, next to the button that sends it). Deny by default, on the server, before anything renders: a
 * Super Admin's verified session — everyone else gets 404 (platform-identity platform-email-console.ts).
 * The secrets are never shown: not even to the Super Admin.
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
  const common = await getTranslations({ locale, namespace: 'common' });
  const texts = flattenTexts(getMessages(locale).emailSettings);
  const dates = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  });
  const sender = view.sender;
  const test = sender?.test ?? null;
  const testing = test?.status === 'queued' || test?.status === 'sending';
  const edge =
    sender?.status === 'verified' ? 'bg-success' : sender ? 'bg-warning' : 'bg-border-strong';

  // The latest test e-mail, in step 3: tinted by how it went, a spinner while it is queued or sending.
  const testLine = test ? (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3',
        test.status === 'sent'
          ? 'border-success/35 bg-success-subtle text-success'
          : test.status === 'failed'
            ? 'border-danger/35 bg-danger-subtle text-danger'
            : 'border-border bg-surface-sunken text-text-muted',
      )}
    >
      {testing ? (
        <Spinner className="mt-0.5 size-4 text-primary" />
      ) : (
        <Icon
          name={test.status === 'sent' ? 'success' : 'error'}
          className="mt-0.5 size-4 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1 [&>p]:text-[14.5px] [&>p]:text-inherit">
        <EmailTestLine test={test} texts={texts} format={(d) => dates.format(d)} />
      </div>
    </div>
  ) : null;

  return (
    <PlatformShell locale={locale} path={PATH}>
      <RefreshWhileTesting active={testing} />
      <div className="flex max-w-4xl flex-col gap-5">
        <PageHeader
          className="mb-0"
          breadcrumbs={[{ label: t('platform.breadcrumb') }, { label: t('platform.title') }]}
          breadcrumbsLabel={common('breadcrumbLabel')}
          title={t('platform.title')}
          description={t('platform.subtitle')}
        />

        <section
          aria-labelledby="platform-email-status-title"
          className="relative grid grid-cols-1 gap-4 overflow-hidden rounded-xl border border-border bg-surface px-5 py-5 shadow-2 md:grid-cols-[auto_minmax(0,1fr)] md:gap-5.5 md:px-7 md:py-6.5"
        >
          <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-1.5', edge)} />
          <span
            aria-hidden="true"
            className="grid size-13 place-items-center rounded-[18px] bg-brand-gradient text-on-brand shadow-brand-glow md:size-16"
          >
            <Icon name="mail" className="size-7" />
          </span>
          <div className="min-w-0">
            <h2
              id="platform-email-status-title"
              className="m-0 text-[13px] font-bold uppercase tracking-[var(--letter-spacing-caps)] text-primary-text"
            >
              {t('platform.statusTitle')}
            </h2>
            <div
              className="mt-2.5 flex flex-col items-start gap-2.5"
              data-testid="platform-email-status"
            >
              {sender?.status === 'verified' ? (
                <>
                  <Badge tone="success" dot>
                    {t('integration.verified', {
                      date: sender.verifiedAt ? dates.format(sender.verifiedAt) : '',
                    })}
                  </Badge>
                  <p className="m-0 text-[17px] font-medium">
                    {t('platform.statusVerified', {
                      address: sender.fromAddress,
                      provider: providerLabel(sender.provider),
                    })}
                  </p>
                </>
              ) : sender ? (
                <>
                  <Badge tone="warning" dot>
                    {t('integration.notVerified')}
                  </Badge>
                  <p className="m-0 text-[17px] font-medium">{t('platform.statusUnverified')}</p>
                </>
              ) : (
                <>
                  <Badge tone="neutral" dot>
                    {t('integration.notVerified')}
                  </Badge>
                  <p className="m-0 text-[17px] font-medium">{t('platform.statusNone')}</p>
                </>
              )}
            </div>
          </div>
        </section>

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

        {view.platformFailed24h > 0 ? (
          <Alert tone="danger" data-testid="platform-email-failed">
            {t('platform.failed24h', { count: view.platformFailed24h })}
          </Alert>
        ) : null}

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
            testLine={testLine}
          />
        ) : null}
      </div>
    </PlatformShell>
  );
}
