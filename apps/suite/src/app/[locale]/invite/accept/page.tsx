import { otherLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Card } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { InviteAcceptView } from '../../../../components/invite/accept-invitation';
import { LanguageToggle } from '../../../../components/language-toggle';
import { inviteErrorTexts } from '../../../../lib/auth-texts';
import { getConfigStatus } from '../../../../lib/config-status';

/**
 * Accept an invitation (screens 8 and 9; FR-IAM-03, T-M2-07). Public. The e-mailed link carries a
 * one-time token in the URL FRAGMENT (`#token=…`, security review M3): browsers never send it to the
 * server, so it is in no access log, proxy log or Referer header. This server page renders only the
 * shell with its texts; the client component reads the fragment, removes it from the address bar and
 * asks what the link is through the public `lookupInvitationAction` (token in the action body, hashed
 * before any lookup, never logged). The page still sends no referrer (metadata below +
 * `Referrer-Policy: no-referrer` for /:locale/invite/*, next.config.ts).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'invite' });
  return {
    title: t('pageTitle'),
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  };
}

const LINK_STATES = ['expired', 'revoked', 'used', 'invalid'] as const;

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();

  const t = await getTranslations({ locale, namespace: 'invite' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const errorsT = await getTranslations({ locale, namespace: 'errors' });

  if (!(status.auth && status.database)) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
          <span className="text-lg font-semibold">{common('productName')}</span>
          <LanguageToggle locale={locale} path="/invite/accept" />
        </header>
        <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
          <h1 className="m-0 text-2xl font-bold">{t('pageTitle')}</h1>
          <Card>
            <p className="m-0 text-text-muted" data-testid="invite-not-configured">
              {errorsT('notConfigured')}
            </p>
          </Card>
        </main>
      </div>
    );
  }

  const target = otherLocale(locale);
  return (
    <InviteAcceptView
      locale={locale}
      productName={common('productName')}
      toggle={{
        href: `/${target}/invite/accept`,
        lang: target,
        label: common('switchLanguage'),
        ariaLabel: common('switchLanguageAria'),
      }}
      texts={{
        pageTitle: t('pageTitle'),
        checking: t('checking'),
        welcomeTitle: String(t.raw('welcomeTitle')),
        intro: t('intro'),
        privacy: String(t.raw('privacy')),
        signedInInvitee: String(t.raw('signedIn.invitee')),
        signedInAccept: t('signedIn.accept'),
        signedInAccepting: t('signedIn.accepting'),
        otherAccount: t('signedIn.otherAccount'),
        signOut: t('signedIn.signOut'),
        signingOut: t('signedIn.signingOut'),
        states: Object.fromEntries(
          LINK_STATES.map((state) => [
            state,
            { title: t(`states.${state}.title`), text: t(`states.${state}.text`) },
          ]),
        ) as Record<(typeof LINK_STATES)[number], { title: string; text: string }>,
        usedSignIn: t('states.used.signIn'),
        usedForgotPassword: t('states.used.forgotPassword'),
      }}
      formLabels={{
        loginEmail: t('loginEmail'),
        loginEmailHint: t('loginEmailHint'),
        displayNameAr: t('displayNameAr'),
        displayNameEn: t('displayNameEn'),
        displayNameHint: t('displayNameHint'),
        optional: common('optional'),
        required: common('required'),
        password: t('password'),
        confirmPassword: t('confirmPassword'),
        showPassword: t('showPassword'),
        rulesLabel: t('rulesLabel'),
        ruleMinLength: t('rules.minLength', { min: '{min}' }),
        ruleMaxBytes: t('rules.maxBytes'),
        ruleMatches: t('rules.matches'),
        ruleMet: t('rules.met'),
        ruleNotMet: t('rules.notMet'),
        passwordTip: t('passwordTip'),
        submit: t('submit'),
        submitting: t('submitting'),
        signInTitle: t('signInToAccept.title'),
        signInIntro: t('signInToAccept.intro'),
        signInSubmit: t('signInToAccept.submit'),
        signInSubmitting: t('signInToAccept.submitting'),
      }}
      fieldTexts={{
        tooShort: t('fieldErrors.tooShort', { min: '{min}' }),
        tooLong: t('fieldErrors.tooLong'),
        mismatch: t('fieldErrors.mismatch'),
        nameTooLong: t('fieldErrors.nameTooLong'),
        nameInvisible: t('fieldErrors.nameInvisible'),
        privacyRequired: t('fieldErrors.privacyRequired'),
        passwordRequired: t('fieldErrors.passwordRequired'),
      }}
      errors={await inviteErrorTexts(locale)}
    />
  );
}
