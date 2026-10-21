import { routing } from '@jadarat/platform-i18n/routing';
import {
  getSessionOrganizationsForRequest,
  isPlatformAdminForRequest,
} from '@jadarat/platform-identity/auth';
import { Alert, Icon, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AuthCard, AuthLanguageSwitch, AuthShell } from '../../../components/auth/auth-shell';
import { OrganizationChooser } from '../../../components/auth/organization-chooser';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { authLanguageSwitch, authShellTexts } from '../../../lib/auth-shell-texts';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { getSessionState, redirectFor } from '../../../lib/session-state';
import { authBrandOf } from '../../../lib/sign-in-brand';

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
  const platform = await getTranslations({ locale, namespace: 'platform' });
  const hasOrganizations = organizations.value.length > 0;
  // Direction C (redesign package 1): the focused frame; the organizations as large rows (initials, name,
  // a chevron), the platform console as a clearly separate card, Sign out in the header.
  return (
    <AuthShell
      variant="focus"
      // The Jadarat brand: this page is about choosing between organizations, so none of their logos.
      brand={authBrandOf(null)}
      texts={await authShellTexts(locale)}
      languageSwitch={
        <AuthLanguageSwitch {...await authLanguageSwitch(locale, '/select-organization')} />
      }
      headerEnd={
        <SignOutButton locale={locale} label={t('signOut')} pendingLabel={t('signingOut')} />
      }
      icon="building"
      size="md"
      title={t('chooseTitle')}
      subtitle={hasOrganizations ? <p>{t('chooseIntro')}</p> : undefined}
    >
      <AuthCard>
        {hasOrganizations ? (
          <OrganizationChooser
            locale={locale}
            organizations={organizations.value.map((org) => ({
              tenantId: org.tenantId,
              name: locale === 'en' ? (org.nameEn ?? org.nameAr) : org.nameAr,
            }))}
            pendingLabel={t('choosing')}
            errors={await authErrorTexts(locale)}
          />
        ) : (
          <Alert tone="warning">{t('errors.noOrganization')}</Alert>
        )}
      </AuthCard>
      {platformAdmin ? (
        <AuthCard data-testid="platform-console-choice" className="md:flex-row md:items-center">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-inverse-surface text-inverse-text"
          >
            <Icon name="building" className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="m-0 text-lg font-bold">{platform('chooser.title')}</h2>
            <p className="m-0 text-text-muted">{platform('chooser.text')}</p>
          </div>
          <a
            href={`/${locale}/platform`}
            className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}
            data-testid="open-platform-console"
          >
            {platform('consoleName')}
            <Icon name="arrow-end" />
          </a>
        </AuthCard>
      ) : null}
    </AuthShell>
  );
}
