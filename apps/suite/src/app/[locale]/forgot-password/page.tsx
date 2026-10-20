import { routing } from '@jadarat/platform-i18n/routing';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AuthLanguageSwitch, AuthShell } from '../../../components/auth/auth-shell';
import { ForgotPasswordForm } from '../../../components/password-reset/forgot-password-form';
import { authLanguageSwitch, authShellTexts } from '../../../lib/auth-shell-texts';
import { passwordResetErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { authBrandOf, signInBrand } from '../../../lib/sign-in-brand';

/**
 * Forgot password (screen 10; FR-IAM-13, NFR-SEC-01, T-M2-08; Kawadir ATS's layout, PO 16 Oct 2026).
 * Public. The answer never says whether the address has an account (the action answers the same, after the
 * same time, in every case).
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
    <AuthShell
      variant="simple"
      brand={authBrandOf(await signInBrand(locale))}
      texts={await authShellTexts(locale)}
      languageSwitch={
        <AuthLanguageSwitch {...await authLanguageSwitch(locale, '/forgot-password')} />
      }
      title={t('forgot.pageTitle')}
      subtitle={<p className="m-0">{t('forgot.intro')}</p>}
      panel={{ icon: 'mail', title: t('forgot.panelTitle'), text: t('forgot.panelText') }}
      notices={
        status.auth ? undefined : (
          <p className="m-0 text-text-muted" data-testid="forgot-not-configured">
            {errorsT('notConfigured')}
          </p>
        )
      }
    >
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
    </AuthShell>
  );
}
