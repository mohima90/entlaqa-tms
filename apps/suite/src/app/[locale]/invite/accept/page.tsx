import { routing } from '@jadarat/platform-i18n/routing';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AuthLanguageSwitch, AuthShell } from '../../../../components/auth/auth-shell';
import { InviteLinkForwarder } from '../../../../components/invite/accept-invitation';
import { authLanguageSwitch, authShellTexts } from '../../../../lib/auth-shell-texts';
import { authBrandOf, signInBrand } from '../../../../lib/sign-in-brand';

/**
 * Invitation links e-mailed before codes (`/[locale]/invite/accept#token=…`, T-M2-07): forwarded in the
 * browser to the sign-up page (`/[locale]/sign-up#code=…`, Kawadir, PO 16 Oct 2026) with the token in the
 * fragment again — it never reaches the server (review M3). No referrer (metadata below +
 * `Referrer-Policy: no-referrer` for /:locale/invite/*, security-headers.ts).
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

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'invite' });
  return (
    <AuthShell
      variant="centered"
      brand={authBrandOf(await signInBrand(locale))}
      texts={await authShellTexts(locale)}
      languageSwitch={<AuthLanguageSwitch {...await authLanguageSwitch(locale, '/sign-up')} />}
      title={t('pageTitle')}
    >
      <InviteLinkForwarder locale={locale} checking={t('checking')} />
    </AuthShell>
  );
}
