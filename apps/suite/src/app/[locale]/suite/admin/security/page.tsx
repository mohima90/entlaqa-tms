import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { SYSTEM_ROLES } from '@jadarat/platform-rbac';
import { Alert, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../components/suite-shell';
import { SecuritySettingsForm } from '../../../../../components/security/security-settings-form';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { REMEMBERED_BROWSER_CHOICES } from '../../../../../lib/security-form';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';
import { securityPageQuery } from '../../../../../lib/users-queries';
import { localizedName } from '../../../../../lib/users-view';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { pageDates } from '../../../../../lib/page-dates';
import { pageStepUp, settingsCommonTexts } from '../../../../../lib/settings-page';

const PATH = '/suite/admin/security';

/**
 * Security settings (approved screen 6 «الأمان»; FR-IAM-12/13, T-M2-10). Read by members with the
 * organization settings permission (Organization Admin, Auditor); changed by the Organization Admin (no
 * authenticator code needed since the PO decision of 14 Oct 2026; were one needed, the page would ask
 * before editing — Q2-1). Direction C (redesign package 2): breadcrumbs, the summary strip, the floating
 * save bar and a confirmation for stricter MFA. The database enforces who may change it and every rule.
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'security' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="security-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const result = await securityPageQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = <Alert tone="warning">{errors('forbidden')}</Alert>;
      } else {
        const common = await getTranslations({ locale, namespace: 'common' });
        content = (
          <Alert
            tone="danger"
            data-testid="security-load-failed"
            action={
              <a
                href={`/${locale}${PATH}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="sync" />
                {common('tryAgain')}
              </a>
            }
          >
            {users('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      content = (
        <Settings
          locale={locale}
          view={result.value}
          organization={context.organizationName ?? ''}
          context={context}
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="security" path={PATH}>
      <PageHeader
        breadcrumbs={[{ label: t('section') }, { label: t('title') }]}
        breadcrumbsLabel={(await getTranslations({ locale, namespace: 'common' }))(
          'breadcrumbLabel',
        )}
        title={t('title')}
        description={
          context.live && context.organizationName
            ? t('intro', { organization: context.organizationName })
            : undefined
        }
      />
      {content}
    </SuiteShell>
  );
}

async function Settings({
  locale,
  view,
  organization,
  context,
}: {
  locale: AppLocale;
  context: SuiteContext;
  view: Extract<Awaited<ReturnType<typeof securityPageQuery>>, { ok: true }>['value'];
  organization: string;
}) {
  const t = await getTranslations({ locale, namespace: 'security' });
  // As the organization shows dates (T-M2-22: Gregorian / Hijri / both, its time zone).
  const dates = pageDates(locale, context);
  const { policy, editAccess } = view;
  const lastChanged = policy.updatedBy
    ? t('lastChanged', {
        date: dates.date(policy.updatedAt),
        name: localizedName(locale, policy.updatedBy.nameAr, policy.updatedBy.nameEn),
      })
    : t('lastChangedDefault');
  return (
    <div className="flex flex-col gap-5">
      {editAccess === 'denied' ? (
        <Alert tone="info" data-testid="security-read-only">
          {t('readOnly')}
        </Alert>
      ) : null}
      <SecuritySettingsForm
        initial={{
          mfaMode: policy.mfaMode,
          mfaRequiredRoles: policy.mfaRequiredRoles,
          mfaGraceDays: policy.mfaGraceDays,
          mfaPromptAdmins: policy.mfaPromptAdmins,
          passwordMinLength: policy.passwordMinLength,
          lockoutThreshold: policy.lockoutThreshold,
          lockoutMinutes: policy.lockoutMinutes,
          sessionIdleMinutes: policy.sessionIdleMinutes,
          sessionMaxHours: policy.sessionMaxHours,
          sessionMaxDevices: policy.sessionMaxDevices,
          rememberedBrowserDays: policy.rememberedBrowserDays,
        }}
        version={policy.version}
        editable={editAccess === 'allowed'}
        roles={SYSTEM_ROLES.map((role) => ({ code: role.code, name: role.name[locale] }))}
        texts={flattenTexts(getMessages(locale).security)}
        common={await settingsCommonTexts(locale)}
        graceTexts={Array.from({ length: 31 }, (_, days) => t('confirm.grace', { days }))}
        rememberedTexts={REMEMBERED_BROWSER_CHOICES.map((days) =>
          days === 0 ? t('mfa.trustedOff') : t('mfa.trustedDays', { days }),
        )}
        organization={organization}
        locale={locale}
        lastChanged={lastChanged}
        errors={await profileErrorTexts(locale)}
        stepUp={await pageStepUp(locale, PATH, 'platform.security.manage')}
      />
    </div>
  );
}
