import 'server-only';
import { otherLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { authLanguageSwitch, authShellTexts } from '../../lib/auth-shell-texts';
import { mfaErrorTexts } from '../../lib/auth-texts';
import { getConfigStatus } from '../../lib/config-status';
import { mfaLinkPath } from '../../lib/mfa-link';
import { authBrandOf, signInBrand } from '../../lib/sign-in-brand';
import { AuthCard, AuthLanguageSwitch, AuthShell } from '../auth/auth-shell';
import { MfaLinkView } from './mfa-link-view';

/**
 * The page of the authenticator set-up e-mail's "not you? remove this app" link (FR-IAM-12, T-M2-10;
 * review H1): `/[locale]/mfa/remove`. Public (the link proves the mailbox; no session needed). The server
 * renders the shell and its texts only; the client view reads the token from the URL fragment. No
 * referrer (metadata + `Referrer-Policy: no-referrer`, next.config.ts), not indexed.
 */
export async function mfaLinkMetadata(params: Promise<{ locale: string }>): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'mfaLink.remove' });
  return {
    title: t('pageTitle'),
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  };
}

export async function MfaLinkPage({ params }: { readonly params: Promise<{ locale: string }> }) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();
  const t = await getTranslations({ locale, namespace: 'mfaLink.remove' });
  const shared = await getTranslations({ locale, namespace: 'mfaLink' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await authShellTexts(locale);
  const brand = authBrandOf(await signInBrand(locale));

  if (!(status.auth && status.database)) {
    const errorsT = await getTranslations({ locale, namespace: 'errors' });
    return (
      <AuthShell
        variant="focus"
        brand={brand}
        texts={shell}
        languageSwitch={<AuthLanguageSwitch {...await authLanguageSwitch(locale, '/mfa/remove')} />}
        icon="shield"
        iconTone="warning"
        size="md"
        title={t('pageTitle')}
      >
        <AuthCard>
          <Alert tone="info" data-testid="mfa-link-not-configured">
            {errorsT('notConfigured')}
          </Alert>
        </AuthCard>
      </AuthShell>
    );
  }

  const target = otherLocale(locale);
  return (
    <MfaLinkView
      locale={locale}
      brand={brand}
      shell={shell}
      toggle={{
        href: mfaLinkPath(target),
        lang: target,
        label: common('switchLanguage'),
        ariaLabel: common('switchLanguageAria'),
      }}
      texts={{
        pageTitle: t('pageTitle'),
        opening: shared('opening'),
        intro: t('intro'),
        warning: t('warning'),
        submit: t('submit'),
        submitting: t('submitting'),
        doneTitle: t('doneTitle'),
        doneText: t('doneText'),
        expiredTitle: shared('expiredTitle'),
        expiredText: t('expiredText'),
        invalidTitle: shared('invalidTitle'),
        invalidText: t('invalidText'),
        newPassword: shared('newPassword'),
        signIn: shared('signIn'),
      }}
      errors={await mfaErrorTexts(locale)}
    />
  );
}
