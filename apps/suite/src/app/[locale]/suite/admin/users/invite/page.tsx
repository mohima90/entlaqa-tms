import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { type InviteFormView, SYSTEM_ROLES } from '@jadarat/platform-rbac';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { InviteUserForm } from '../../../../../../components/users/invite-user-form';
import { INVITED_FLASH_PARAM } from '../../../../../../lib/invite-form';
import { expiryFrom } from '../../../../../../lib/invitations-view';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';
import { inviteFormQuery } from '../../../../../../lib/users-queries';
import { localizedName } from '../../../../../../lib/users-view';

/** Text keys of the form (namespace `invitations.form`). */
const LABEL_KEYS = [
  'person',
  'email',
  'emailHint',
  'firstNameAr',
  'familyNameAr',
  'addEnglishName',
  'firstNameEn',
  'familyNameEn',
  'department',
  'noDepartment',
  'branch',
  'noBranch',
  'manager',
  'noManager',
  'managerHint',
  'managerHintAll',
  'allDepartmentsManagers',
  'departmentManagersOnly',
  'employeeNumber',
  'employeeNumberHint',
  'primaryRole',
  'primaryRoleHint',
  'showCommonRoles',
  'rolesHelp',
  'additionalRoles',
  'additionalRolesHint',
  'privileged',
  'language',
  'submit',
  'submitting',
  'back',
] as const;
const FIELD_ERROR_KEYS = [
  'required',
  'name',
  'email',
  'emailTaken',
  'employeeNumber',
  'employeeNumberTaken',
  'roleRequired',
  'roleNotAllowed',
  'roles',
  'unit',
  'manager',
] as const;

/**
 * Invite a user (T-M2-07, FR-IAM-03, BR-IAM-1; approved screen 2): HR Manager or Organization Admin
 * (`platform.user.invite`); privileged roles only by the Organization Admin with an authenticator code.
 */
export default async function InviteUserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const usersHref = `/${locale}/suite/admin/users`;

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await inviteFormQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN') {
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
      content = await inviteForm(locale, result.value, usersHref);
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path="/suite/admin/users/invite">
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={usersHref}>{t('breadcrumb')}</a>
      </nav>
      <h1 className="mb-2 mt-0 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-6 mt-0 text-text-muted">{t('intro')}</p>
      {content}
    </SuiteShell>
  );
}

async function inviteForm(
  locale: AppLocale,
  view: InviteFormView,
  usersHref: string,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const format = await getFormatter({ locale });
  const labels: Record<string, string> = Object.fromEntries(
    LABEL_KEYS.map((k) => [k, t(`form.${k}`)]),
  );
  labels.required = common('required');
  labels.optional = common('optional');
  labels.showAllRoles = t('form.showAllRoles', { count: SYSTEM_ROLES.length });
  labels['language.ar'] = t('form.languages.ar');
  labels['language.en'] = t('form.languages.en');
  labels.expiryNotice = t('form.expiryNotice', {
    date: format.dateTime(expiryFrom(new Date()), 'long'),
  });
  if (view.privilegedAccess !== 'allowed') {
    labels.privilegedLocked =
      view.privilegedAccess === 'step_up_required'
        ? t('form.privilegedNeedsCode')
        : t('form.privilegedAdminOnly');
  }
  const fieldTexts: Record<string, string> = Object.fromEntries(
    FIELD_ERROR_KEYS.map((k) => [k, t(`form.fieldErrors.${k}`)]),
  );
  const unit = (u: { id: string; nameAr: string; nameEn: string | null }) => ({
    id: u.id,
    name: localizedName(locale, u.nameAr, u.nameEn),
  });

  return (
    <Card>
      <InviteUserForm
        departments={view.orgUnits.departments.map(unit)}
        branches={view.orgUnits.branches.map(unit)}
        managers={view.managers.map((m) => ({
          personId: m.personId,
          name: localizedName(locale, m.nameAr, m.nameEn),
          active: m.active,
          departmentIds: m.departmentIds,
        }))}
        catalogue={SYSTEM_ROLES.map((r) => ({
          code: r.code,
          name: r.name[locale],
          description: r.description[locale],
          privileged: r.privileged,
        }))}
        privilegedAllowed={view.privilegedAccess === 'allowed'}
        labels={labels}
        fieldTexts={fieldTexts}
        errors={await profileErrorTexts(locale)}
        usersHref={usersHref}
        successHref={`${usersHref}?tab=invited&${INVITED_FLASH_PARAM}=1`}
        rolesHref={`/${locale}/suite/admin/roles`}
      />
    </Card>
  );
}
