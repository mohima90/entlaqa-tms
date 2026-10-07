import { routing } from '@jadarat/platform-i18n/routing';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { LanguageToggle } from '../../../components/language-toggle';
import { ForgotPasswordForm } from '../../../components/password-reset/forgot-password-form';
import { passwordResetErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';

/**
 * Forgot password (screen 10; FR-IAM-13, NFR-SEC-01, T-M2-08). Public. The answer never says whether
 * the address has an account (the action answers the same, after the same time, in every case).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'passwordReset.forgot' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();

  const t = await getTranslations({ locale, namespace: 'passwordReset' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const errorsT = await getTranslations({ locale, namespace: 'errors' });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{common('productName')}</span>
        <LanguageToggle locale={locale} path="/forgot-password" />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold">{t('forgot.pageTitle')}</h1>
          <p className="m-0 text-text-muted">{t('forgot.intro')}</p>
        </div>
        {status.auth ? null : (
          <p className="m-0 text-text-muted" data-testid="forgot-not-configured">
            {errorsT('notConfigured')}
          </p>
        )}
        <ForgotPasswordForm
          locale={locale}
          disabled={!status.auth}
          texts={{
            emailLabel: t('forgot.emailLabel'),
            required: common('required'),
            submit: t('forgot.submit'),
            submitting: t('forgot.submitting'),
            backToSignIn: t('forgot.backToSignIn'),
            emailInvalid: t('forgot.emailInvalid'),
            sentTitle: t('sent.title'),
            sentText: String(t.raw('sent.text')),
            sentValidity: String(t.raw('sent.validity')),
            sentSpam: t('sent.spam'),
            resend: t('sent.resend'),
            resendIn: String(t.raw('sent.resendIn')),
            resending: t('sent.resending'),
            resent: t('sent.resent'),
          }}
          errors={await passwordResetErrorTexts(locale)}
        />
      </main>
    </div>
  );
}
