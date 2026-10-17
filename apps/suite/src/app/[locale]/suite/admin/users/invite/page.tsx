import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { InviteFormView } from '@jadarat/platform-rbac';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { InviteUserForm } from '../../../../../../components/users/invite-user-form';
import { INVITED_FLASH_PARAM } from '../../../../../../lib/invite-form';
import { inviteCopyTexts } from '../../../../../../lib/invite-copy-texts';
import { expiryFrom } from '../../../../../../lib/invitations-view';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { type SuiteContext, getSuiteContext } from '../../../../../../lib/suite-context';
import { pageDates } from '../../../../../../lib/page-dates';
import { roleOptions } from '../../../../../../lib/role-choice';
import { roleSelectTexts, scopeUnitTexts } from '../../../../../../lib/role-texts';
import {
  scopeUnitChoices,
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../../lib/structure-view';
import { inviteFormQuery } from '../../../../../../lib/users-queries';
import { localizedName } from '../../../../../../lib/users-view';

/** Text keys of the form (namespace `invitations.form`). */
const LABEL_KEYS = [
  'person',
  'email',
  'emailHint',
  'firstNameAr',
  'familyNameAr',
  'addArabicName',
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
  'role',
  'roleHint',
  'departmentsHint',
  'rolesHelp',
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
  'roleUnknown',
  'unit',
  'manager',
] as const;

/**
 * Invite a user (T-M2-07, FR-IAM-03, BR-IAM-1; approved screen 2): HR Manager or Organization Admin
 * (`platform.user.invite`); one role per person (EP-ROLES), privileged roles only by the Organization
 * Admin, every ordinary role also by the HR Manager (who can give what, PO 17 Oct 2026).
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
      content = await inviteForm(locale, result.value, usersHref, context);
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
  context: SuiteContext,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const labels: Record<string, string> = Object.fromEntries(
    LABEL_KEYS.map((k) => [k, t(`form.${k}`)]),
  );
  labels.required = common('required');
  labels.optional = common('optional');
  // The success panel (Kawadir: copy the code or the link right away).
  labels['created.title'] = t('created.title');
  labels['created.text'] = String(t.raw('created.text'));
  labels['created.toList'] = t('created.toList');
  labels['created.inviteAnother'] = t('created.inviteAnother');
  labels['language.ar'] = t('form.languages.ar');
  labels['language.en'] = t('form.languages.en');
  labels.expiryNotice = t('form.expiryNotice', {
    date: pageDates(locale, context).long(expiryFrom(new Date())),
  });
  labels.privilegedLocked = t('form.privilegedAdminOnly');
  const fieldTexts: Record<string, string> = Object.fromEntries(
    FIELD_ERROR_KEYS.map((k) => [k, t(`form.fieldErrors.${k}`)]),
  );
  // The unit of a department-limited custom role (EP-ORG, T-M3-09): the edit-role dialog's texts.
  const unitTexts = await getTranslations({ locale, namespace: 'editRoles.unit' });
  fieldTexts.unitRequired = unitTexts('unitRequired');
  fieldTexts.unitNotAllowed = unitTexts('unitNotAllowed');
  const unit = (u: { id: string; nameAr: string; nameEn: string | null }) => ({
    id: u.id,
    name: localizedName(locale, u.nameAr, u.nameEn),
  });
  // The organization's own level names (guided-test feedback #3): the field is named after the first
  // level, or «Unit» with each choice's level when levels mix.
  const ordinals = view.orgUnits.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  labels.department = unitsLabel(view.levels, ordinals, locale, t('form.department'));
  const department = (u: (typeof view.orgUnits.departments)[number]) => ({
    id: u.id,
    name: unitNameWithLevel(
      localizedName(locale, u.nameAr, u.nameEn),
      u.levelOrdinal,
      view.levels,
      locale,
      withLevels,
    ),
  });

  return (
    <Card>
      <InviteUserForm
        defaultLocale={context.regional.defaultLocale}
        departments={view.orgUnits.departments.map(department)}
        branches={view.orgUnits.branches.map(unit)}
        managers={view.managers.map((m) => ({
          personId: m.personId,
          name: localizedName(locale, m.nameAr, m.nameEn),
          active: m.active,
          departmentIds: m.departmentIds,
        }))}
        roles={roleOptions(view.roles, locale)}
        roleTexts={await roleSelectTexts(locale)}
        scopeUnits={scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale)}
        unitTexts={await scopeUnitTexts(locale, view.scopeUnits.structureVisible)}
        labels={labels}
        fieldTexts={fieldTexts}
        errors={await profileErrorTexts(locale)}
        usersHref={usersHref}
        successHref={`${usersHref}?tab=invited&${INVITED_FLASH_PARAM}=1`}
        rolesHref={`/${locale}/suite/admin/roles`}
        copyTexts={await inviteCopyTexts(locale)}
        uiLocale={locale}
      />
    </Card>
  );
}
