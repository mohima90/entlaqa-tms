import { otherLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { readPasswordResetDelivery } from '@jadarat/platform-identity';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AuthLanguageSwitch, AuthShell } from '../../../components/auth/auth-shell';
import { ResetPasswordView } from '../../../components/password-reset/reset-password-view';
import { authLanguageSwitch, authShellTexts } from '../../../lib/auth-shell-texts';
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

  const shell = await authShellTexts(locale);
  const panel = {
    icon: 'lock' as const,
    title: t('reset.panelTitle'),
    text: t('reset.panelText'),
  };
  const authT = await getTranslations({ locale, namespace: 'auth' });

  if (!status.auth) {
    return (
      <AuthShell
        variant="simple"
        texts={shell}
        panel={panel}
        languageSwitch={
          <AuthLanguageSwitch {...await authLanguageSwitch(locale, '/reset-password')} />
        }
        title={t('reset.pageTitle')}
      >
        <p className="m-0 text-text-muted" data-testid="reset-not-configured">
          {errorsT('notConfigured')}
        </p>
      </AuthShell>
    );
  }

  const target = otherLocale(locale);
  return (
    <ResetPasswordView
      locale={locale}
      shell={shell}
      panel={panel}
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
        showPassword: authT('showPassword'),
        hidePassword: authT('hidePassword'),
        rememberBrowser: t('reset.rememberBrowser'),
        rememberBrowserHint: t('reset.rememberBrowserHint'),
        required: common('required'),
        rulesLabel: t('reset.rulesLabel'),
        ruleMinLength: t('reset.rules.minLength', { min: '{min}' }),
        ruleMaxBytes: t('reset.rules.maxBytes'),
        ruleMatches: t('reset.rules.matches'),
        ruleMet: t('reset.rules.met'),
        ruleNotMet: t('reset.rules.notMet'),
        passwordTip: t('reset.passwordTip'),
        sessionsNotice: t('reset.sessionsNotice'),
        codeIntro: t('reset.codeIntro'),
        codeOptionalIntro: t('reset.codeOptionalIntro'),
        optional: common('optional'),
        codeLabel: t('reset.codeLabel'),
        codeHint: t('reset.codeHint'),
        codeFormat: t('fieldErrors.codeFormat'),
        submit: t('reset.submit'),
        submitting: t('reset.submitting'),
        validity: String(t.raw('reset.validity')),
        tooShort: t('fieldErrors.tooShort', { min: '{min}' }),
        tooLong: t('fieldErrors.tooLong'),
        mismatch: t('fieldErrors.mismatch'),
        invalidTitle: t('invalidLink.title'),
        invalidText: t('invalidLink.text'),
        requestNew: t('invalidLink.requestNew'),
        signIn: t('invalidLink.signIn'),
      }}
      errors={await passwordResetErrorTexts(locale)}
      // Auth's own mailer cannot say whether the account has an authenticator app (T-M2-10).
      codeOptional={readPasswordResetDelivery(process.env) !== 'worker'}
    />
  );
}
