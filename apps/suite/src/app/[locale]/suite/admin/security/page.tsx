import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { SYSTEM_ROLES } from '@jadarat/platform-rbac';
import { Alert, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../components/suite-shell';
import { SecuritySettingsForm } from '../../../../../components/security/security-settings-form';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { stepUpHref } from '../../../../../lib/mfa-view';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { securityPageQuery } from '../../../../../lib/users-queries';
import { localizedName } from '../../../../../lib/users-view';

const PATH = '/suite/admin/security';

/** Every text of a namespace as raw strings by dotted key (the form fills placeholders itself). */
function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  if (typeof node !== 'object' || node === null) return {};
  return Object.assign(
    {},
    ...Object.entries(node).map(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key),
    ),
  ) as Record<string, string>;
}

/**
 * Security settings (approved screen 6 «الأمان»; FR-IAM-12/13, T-M2-10). Read by members with the
 * organization settings permission (Organization Admin, Auditor); changed by the Organization Admin with
 * an authenticator code (high risk, AAL2 — PO decision D-IAM-01): at AAL1 the page says so and links to
 * the code. The database enforces who may change it and every rule.
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
        content = (
          <Alert tone="danger">
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
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="security" path={PATH}>
      <p className="m-0 text-sm text-text-muted">{t('section')}</p>
      <h1 className="mb-4 mt-0 text-2xl font-bold">{t('title')}</h1>
      {content}
    </SuiteShell>
  );
}

async function Settings({
  locale,
  view,
  organization,
}: {
  locale: AppLocale;
  view: Extract<Awaited<ReturnType<typeof securityPageQuery>>, { ok: true }>['value'];
  organization: string;
}) {
  const t = await getTranslations({ locale, namespace: 'security' });
  const format = await getFormatter({ locale });
  const { policy, editAccess } = view;
  const lastChanged = policy.updatedBy
    ? t('lastChanged', {
        date: format.dateTime(policy.updatedAt, 'medium'),
        name: localizedName(locale, policy.updatedBy.nameAr, policy.updatedBy.nameEn),
      })
    : t('lastChangedDefault');
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-text-muted">{t('intro', { organization })}</p>
      {editAccess === 'step_up_required' ? (
        <Alert tone="warning" data-testid="security-step-up">
          <span className="flex flex-wrap items-center gap-3">
            <span>{t('stepUp')}</span>
            <a
              href={stepUpHref(locale, `/${locale}${PATH}`)}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              data-testid="security-step-up-link"
            >
              {t('stepUpLink')}
            </a>
          </span>
        </Alert>
      ) : null}
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
        }}
        version={policy.version}
        editable={editAccess === 'allowed'}
        roles={SYSTEM_ROLES.map((role) => ({ code: role.code, name: role.name[locale] }))}
        texts={flatten(getMessages(locale).security)}
        lastChanged={lastChanged}
        errors={await profileErrorTexts(locale)}
        stepUpHref={stepUpHref(locale, `/${locale}${PATH}`)}
      />
    </div>
  );
}
