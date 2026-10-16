import { routing } from '@jadarat/platform-i18n/routing';
import {
  getSessionOrganizationsForRequest,
  isPlatformAdminForRequest,
} from '@jadarat/platform-identity/auth';
import { Card, Icon, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { OrganizationChooser } from '../../../components/auth/organization-chooser';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { LanguageToggle } from '../../../components/language-toggle';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { getSessionState, redirectFor } from '../../../lib/session-state';

/**
 * Organization chooser after sign-in when the account belongs to several organizations. A Platform Super
 * Admin (FR-ADM-17; the database decides) is also offered the platform console — and sent straight there
 * when they belong to no organization.
 */
export default async function SelectOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // TODO(M2, ADR 0002 §3): switching organization from inside the suite; for now: sign out, sign in.
  const session = await getSessionState(getConfigStatus());
  const elsewhere = redirectFor(locale, session, 'select-organization');
  if (elsewhere) redirect(elsewhere);

  const organizations = await getSessionOrganizationsForRequest();
  if (!organizations.ok) redirect(`/${locale}/sign-in`);
  const platformAdmin = await isPlatformAdminForRequest();
  if (platformAdmin && organizations.value.length === 0) redirect(`/${locale}/platform`);

  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const platform = await getTranslations({ locale, namespace: 'platform' });
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
        {platformAdmin ? (
          <Card title={platform('chooser.title')} data-testid="platform-console-choice">
            <p className="mb-4 mt-0 text-text-muted">{platform('chooser.text')}</p>
            <a
              href={`/${locale}/platform`}
              className={buttonClasses({ variant: 'secondary' })}
              data-testid="open-platform-console"
            >
              <Icon name="building" />
              {platform('consoleName')}
            </a>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
