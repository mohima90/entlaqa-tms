import { routing } from '@jadarat/platform-i18n/routing';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AuthLanguageSwitch, AuthShell } from '../../../components/auth/auth-shell';
import { DropFragment, SignUpView } from '../../../components/invite/sign-up-view';
import { authLanguageSwitch, authShellTexts } from '../../../lib/auth-shell-texts';
import { inviteErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';

/**
 * Join with an invitation code (FR-IAM-03; Kawadir ATS's sign-up "join" screen, PO 16 Oct 2026). Public.
 * The copied or e-mailed link is `/{locale}/sign-up#code=CODE`: the code is in the URL FRAGMENT (review
 * M3), so it is in no access log, proxy log or Referer header; this server page renders only the frame and
 * its texts, the client view reads the fragment (or the code typed by hand) and asks through the public
 * `lookupInvitationAction` (limited per client and per code). No referrer either way (metadata below +
 * `Referrer-Policy: no-referrer` for /:locale/sign-up, security-headers.ts).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'signUp' });
  return {
    title: t('pageTitle'),
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  };
}

const LINK_STATES = ['expired', 'revoked', 'used', 'invalid'] as const;

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();

  const t = await getTranslations({ locale, namespace: 'signUp' });
  const invite = await getTranslations({ locale, namespace: 'invite' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const errorsT = await getTranslations({ locale, namespace: 'errors' });
  const shell = await authShellTexts(locale);
  const toggle = await authLanguageSwitch(locale, '/sign-up');

  if (!(status.auth && status.database)) {
    return (
      <AuthShell
        variant="centered"
        texts={shell}
        languageSwitch={<AuthLanguageSwitch {...toggle} />}
        title={t('pageTitle')}
      >
        <p className="m-0 text-text-muted" data-testid="invite-not-configured">
          {errorsT('notConfigured')}
        </p>
        <DropFragment />
      </AuthShell>
    );
  }

  return (
    <SignUpView
      locale={locale}
      shell={shell}
      toggle={toggle}
      texts={{
        pageTitle: t('pageTitle'),
        titleWithOrg: String(t.raw('titleWithOrg')),
        intro: t('intro'),
        introValid: String(t.raw('introValid')),
        codeLabel: t('codeLabel'),
        codePlaceholder: t('codePlaceholder'),
        codeFromLink: t('codeFromLink'),
        codeChecking: t('codeChecking'),
        codeValid: String(t.raw('codeValid')),
        codeStates: Object.fromEntries(
          LINK_STATES.map((state) => [state, t(`codeStates.${state}`)]),
        ) as Record<(typeof LINK_STATES)[number], string>,
        emailPreFilled: t('emailPreFilled'),
        submit: String(t.raw('submit')),
        submitDefault: t('submitDefault'),
        haveAccount: t('haveAccount'),
        signIn: t('signIn'),
        privacy: String(invite.raw('privacy')),
        signedInInvitee: String(invite.raw('signedIn.invitee')),
        signedInAccept: invite('signedIn.accept'),
        signedInAccepting: invite('signedIn.accepting'),
        otherAccount: invite('signedIn.otherAccount'),
        signOut: invite('signedIn.signOut'),
        signingOut: invite('signedIn.signingOut'),
        usedSignIn: invite('states.used.signIn'),
        usedForgotPassword: invite('states.used.forgotPassword'),
        required: common('required'),
      }}
      formLabels={{
        loginEmail: invite('loginEmail'),
        displayNameAr: invite('displayNameAr'),
        displayNameEn: invite('displayNameEn'),
        displayNameHint: invite('displayNameHint'),
        optional: common('optional'),
        required: common('required'),
        password: invite('password'),
        confirmPassword: invite('confirmPassword'),
        showPassword: auth('showPassword'),
        hidePassword: auth('hidePassword'),
        rulesLabel: invite('rulesLabel'),
        ruleMinLength: invite('rules.minLength', { min: '{min}' }),
        ruleMaxBytes: invite('rules.maxBytes'),
        ruleMatches: invite('rules.matches'),
        ruleMet: invite('rules.met'),
        ruleNotMet: invite('rules.notMet'),
        passwordTip: invite('passwordTip'),
        submitting: invite('submitting'),
        signInTitle: invite('signInToAccept.title'),
        signInIntro: invite('signInToAccept.intro'),
        signInSubmit: invite('signInToAccept.submit'),
        signInSubmitting: invite('signInToAccept.submitting'),
      }}
      fieldTexts={{
        tooShort: invite('fieldErrors.tooShort', { min: '{min}' }),
        tooLong: invite('fieldErrors.tooLong'),
        mismatch: invite('fieldErrors.mismatch'),
        nameTooLong: invite('fieldErrors.nameTooLong'),
        nameInvisible: invite('fieldErrors.nameInvisible'),
        privacyRequired: invite('fieldErrors.privacyRequired'),
        passwordRequired: invite('fieldErrors.passwordRequired'),
      }}
      errors={await inviteErrorTexts(locale)}
    />
  );
}
