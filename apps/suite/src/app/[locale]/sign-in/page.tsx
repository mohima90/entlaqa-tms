import { isCodeSignInOffered } from '@jadarat/platform-identity/auth';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AuthAlt, AuthLanguageSwitch } from '../../../components/auth/auth-shell';
import { EndedSessionSignOut } from '../../../components/auth/ended-session-sign-out';
import { SignInView } from '../../../components/auth/sign-in-form';
import { BrandStyle } from '../../../components/branding/brand-style';
import {
  authLanguageSwitch,
  authShellTexts,
  signInPanelTexts,
} from '../../../lib/auth-shell-texts';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { noticeFrom } from '../../../lib/password-reset-link';
import { getSessionState, redirectFor } from '../../../lib/session-state';
import { authBrandOf, brandIcons, signInBrand } from '../../../lib/sign-in-brand';

/** The organization's browser-tab icon on its sign-in page (WP-ADM-02); Jadarat's otherwise. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return brandIcons(await signInBrand(locale));
}

/**
 * Sign-in (T-M1-D03; Kawadir ATS's flow, PO 16 Oct 2026; direction C look, redesign package 1): the split
 * frame with the brand panel, «مرحبًا بعودتك» / "Welcome back", the work e-mail first and then the password or «Email me a code instead»
 * (WP-ADM-05, offered where Auth's Send Email hook is set up). Links to "forgot password" (screen 10, T-M2-08) and to joining
 * with an invitation code (/sign-up); shows the notice after a password reset or an ended session.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();

  // Already signed in → onwards. A token the database rejects counts as signed out (the form shows; a
  // new sign-in replaces the session), so this page and /suite can never redirect to each other. An
  // ended session (T-M2-10) shows the notice and is signed out at Auth by the page.
  const session = await getSessionState(status);
  const elsewhere = redirectFor(locale, session, 'sign-in');
  if (elsewhere) redirect(elsewhere);

  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const notice = noticeFrom(await searchParams);
  const resetT = await getTranslations({ locale, namespace: 'passwordReset' });
  // The organization's look (WP-ADM-02): its colours, logo and sign-in picture (Kawadir login).
  const brand = await signInBrand(locale);
  return (
    <>
      <BrandStyle colors={brand?.colors ?? null} />
      <SignInView
        locale={locale}
        brand={authBrandOf(brand)}
        disabled={!status.auth}
        codeSignIn={isCodeSignInOffered()}
        shell={await authShellTexts(locale)}
        panel={await signInPanelTexts(locale)}
        languageSwitch={<AuthLanguageSwitch {...await authLanguageSwitch(locale, '/sign-in')} />}
        title={t('welcomeBack')}
        codeTitle={t('signInCode.title')}
        subtitles={{
          email: t('enterEmailToContinue'),
          method: t('passwordStepIntro'),
          code: t('signInCode.subtitle'),
        }}
        notices={
          notice === 'password-reset' ||
          notice === 'session-ended' ||
          session.kind === 'session-ended' ? (
            <>
              {notice === 'password-reset' ? (
                <Alert tone="success" data-testid="password-reset-notice">
                  {resetT('notice')}
                </Alert>
              ) : null}
              {notice === 'session-ended' || session.kind === 'session-ended' ? (
                <Alert tone="info" data-testid="session-ended-notice">
                  {t('sessionEnded')}
                </Alert>
              ) : null}
              {session.kind === 'session-ended' ? <EndedSessionSignOut /> : null}
            </>
          ) : undefined
        }
        before={
          status.auth ? null : (
            <Alert tone="info" data-testid="auth-not-configured">
              {t('notConfigured')}
            </Alert>
          )
        }
        after={
          <AuthAlt>
            {t('haveInvitation')}{' '}
            <a href={`/${locale}/sign-up`} data-testid="join-with-code-link">
              {t('joinWithCode')}
            </a>
          </AuthAlt>
        }
        labels={{
          email: t('emailLabel'),
          password: t('passwordLabel'),
          required: common('required'),
          rememberBrowser: t('rememberBrowser'),
          rememberBrowserHint: t('rememberBrowserHint'),
          submit: t('submit'),
          submitting: t('submitting'),
          continue: t('continue'),
          changeEmail: t('changeEmail'),
          changeEmailAria: t('changeEmailAria'),
          forgotShort: t('forgotShort'),
          forgotShortAria: t('forgotShortAria'),
          showPassword: t('showPassword'),
          hidePassword: t('hidePassword'),
          emailInvalid: t('emailInvalid'),
          emailPlaceholder: t('emailPlaceholder'),
          passwordPlaceholder: t('passwordPlaceholder'),
          codeInstead: t('signInCode.codeInstead'),
          or: t('signInCode.or'),
          sendingCode: t('signInCode.sending'),
          code: {
            intro: t.raw('signInCode.intro') as string,
            label: t('signInCode.label'),
            digit: t.raw('signInCode.digit') as string,
            spam: t('signInCode.spam'),
            remember: t('signInCode.remember'),
            rememberHint: t('signInCode.rememberHint'),
            submit: t('signInCode.submit'),
            submitting: t('signInCode.submitting'),
            resendIn: t.raw('signInCode.resendIn') as string,
            resend: t('signInCode.resend'),
            resendLead: t('signInCode.resendLead'),
            resending: t('signInCode.resending'),
            resent: t('signInCode.resent'),
            resendReady: t('signInCode.resendReady'),
            errFormat: t('signInCode.errFormat'),
            triesLeft: t.raw('signInCode.triesLeft') as Record<string, string>,
            lockedHelp: t('signInCode.lockedHelp'),
            usePassword: t('signInCode.usePassword'),
          },
        }}
        errors={await authErrorTexts(locale)}
      />
    </>
  );
}
