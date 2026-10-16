import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AuthLanguageSwitch } from '../../../components/auth/auth-shell';
import { EndedSessionSignOut } from '../../../components/auth/ended-session-sign-out';
import { SignInView } from '../../../components/auth/sign-in-form';
import {
  authLanguageSwitch,
  authShellTexts,
  signInPanelTexts,
} from '../../../lib/auth-shell-texts';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { noticeFrom } from '../../../lib/password-reset-link';
import { getSessionState, redirectFor } from '../../../lib/session-state';

/**
 * Sign-in (T-M1-D03; UI and UX of Kawadir ATS one-to-one, PO 16 Oct 2026): the split frame with the brand
 * panel, «مرحبًا بعودتك» / "Welcome back", the work e-mail first and then the password (the e-mailed code
 * comes later with the platform sender). Links to "forgot password" (screen 10, T-M2-08) and to joining
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
  return (
    <SignInView
      locale={locale}
      disabled={!status.auth}
      shell={await authShellTexts(locale)}
      panel={await signInPanelTexts(locale)}
      languageSwitch={<AuthLanguageSwitch {...await authLanguageSwitch(locale, '/sign-in')} />}
      title={t('welcomeBack')}
      subtitles={{ email: t('enterEmailToContinue'), method: t('passwordStepIntro') }}
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
          <p className="mb-4 mt-0 text-text-muted" data-testid="auth-not-configured">
            {t('notConfigured')}
          </p>
        )
      }
      after={
        <p className="mb-0 mt-6 text-center text-sm text-text-muted">
          {t('haveInvitation')}{' '}
          <a
            href={`/${locale}/sign-up`}
            className="font-semibold text-primary-text"
            data-testid="join-with-code-link"
          >
            {t('joinWithCode')}
          </a>
        </p>
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
      }}
      errors={await authErrorTexts(locale)}
    />
  );
}
