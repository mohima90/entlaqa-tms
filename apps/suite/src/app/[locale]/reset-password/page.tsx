import { otherLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Card } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { LanguageToggle } from '../../../components/language-toggle';
import { ResetPasswordView } from '../../../components/password-reset/reset-password-view';
import { passwordResetErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';

/**
 * Set a new password (screen 11; FR-IAM-13, NFR-SEC-01, T-M2-08). Public. Auth's e-mail links here with
 * the single-use token in the URL FRAGMENT (`#token_hash=…&type=recovery`): browsers never send it to the
 * server, so it is in no access log, proxy log or Referer header. This server page renders only the shell
 * with its texts and verifies nothing (a link scanner cannot spend the token); the client component reads
 * the fragment, removes it from the address bar and sends it with the new password to the public
 * `completePasswordResetAction`. No referrer either way (metadata below + `Referrer-Policy: no-referrer`
 * for /:locale/reset-password, next.config.ts).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'passwordReset.reset' });
  return {
    title: t('pageTitle'),
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({
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

  if (!status.auth) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
          <span className="text-lg font-semibold">{common('productName')}</span>
          <LanguageToggle locale={locale} path="/reset-password" />
        </header>
        <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
          <h1 className="m-0 text-2xl font-bold">{t('reset.pageTitle')}</h1>
          <Card>
            <p className="m-0 text-text-muted" data-testid="reset-not-configured">
              {errorsT('notConfigured')}
            </p>
          </Card>
        </main>
      </div>
    );
  }

  const target = otherLocale(locale);
  return (
    <ResetPasswordView
      locale={locale}
      productName={common('productName')}
      toggle={{
        href: `/${target}/reset-password`,
        lang: target,
        label: common('switchLanguage'),
        ariaLabel: common('switchLanguageAria'),
      }}
      texts={{
        pageTitle: t('reset.pageTitle'),
        opening: t('reset.opening'),
        intro: t('reset.intro'),
        password: t('reset.password'),
        confirmPassword: t('reset.confirmPassword'),
        showPassword: t('reset.showPassword'),
        required: common('required'),
        rulesLabel: t('reset.rulesLabel'),
        ruleMinLength: t('reset.rules.minLength'),
        ruleMaxBytes: t('reset.rules.maxBytes'),
        ruleMatches: t('reset.rules.matches'),
        ruleMet: t('reset.rules.met'),
        ruleNotMet: t('reset.rules.notMet'),
        passwordTip: t('reset.passwordTip'),
        sessionsNotice: t('reset.sessionsNotice'),
        submit: t('reset.submit'),
        submitting: t('reset.submitting'),
        validity: String(t.raw('reset.validity')),
        tooShort: t('fieldErrors.tooShort'),
        tooLong: t('fieldErrors.tooLong'),
        mismatch: t('fieldErrors.mismatch'),
        invalidTitle: t('invalidLink.title'),
        invalidText: t('invalidLink.text'),
        requestNew: t('invalidLink.requestNew'),
        signIn: t('invalidLink.signIn'),
      }}
      errors={await passwordResetErrorTexts(locale)}
    />
  );
}
