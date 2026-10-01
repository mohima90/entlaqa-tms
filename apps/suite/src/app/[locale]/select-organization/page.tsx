import { hasTenant } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { getSessionOrganizationsForRequest } from '@jadarat/platform-identity/auth';
import { getVerifiedClaims } from '@jadarat/platform-identity/next';
import { Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { OrganizationChooser } from '../../../components/auth/organization-chooser';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { LanguageToggle } from '../../../components/language-toggle';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';

/** Organization chooser after sign-in when the account belongs to several organizations. */
export default async function SelectOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!getConfigStatus().auth) redirect(`/${locale}/sign-in`);

  const claims = await getVerifiedClaims();
  if (!claims.ok) redirect(`/${locale}/sign-in`);
  if (hasTenant(claims.value)) redirect(`/${locale}/suite`);

  const organizations = await getSessionOrganizationsForRequest();
  if (!organizations.ok) redirect(`/${locale}/sign-in`);

  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{common('productName')}</span>
        <div className="flex items-center gap-2">
          <LanguageToggle locale={locale} path="/select-organization" />
          <SignOutButton locale={locale} label={t('signOut')} pendingLabel={t('signingOut')} />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
        <h1 className="m-0 text-2xl font-bold">{t('chooseTitle')}</h1>
        <Card>
          {organizations.value.length > 0 ? (
            <>
              <p className="mb-4 mt-0 text-text-muted">{t('chooseIntro')}</p>
              <OrganizationChooser
                locale={locale}
                organizations={organizations.value.map((org) => ({
                  tenantId: org.tenantId,
                  name: locale === 'en' ? (org.nameEn ?? org.nameAr) : org.nameAr,
                }))}
                pendingLabel={t('choosing')}
                errors={await authErrorTexts(locale)}
              />
            </>
          ) : (
            <p className="m-0 text-text-muted">{t('errors.noOrganization')}</p>
          )}
        </Card>
      </main>
    </div>
  );
}
