import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CurrentUnit } from '@jadarat/platform-db';
import type { EditUserView } from '@jadarat/platform-rbac';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import { EditUserForm } from '../../../../../../../components/users/edit-user-form';
import { formStateFrom } from '../../../../../../../lib/profile-form';
import { profileErrorTexts } from '../../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
import { editUserQuery } from '../../../../../../../lib/users-queries';
import { localizedName } from '../../../../../../../lib/users-view';

/** Text keys of the form (namespace `editUser`). */
const LABEL_KEYS = [
  'arabicName',
  'englishName',
  'prefilledName',
  'currentName',
  'contact',
  'email',
  'emailHint',
  'emailIsLogin',
  'mobile',
  'mobileHint',
  'language',
  'work',
  'employeeNumber',
  'employeeNumberHint',
  'hireDate',
  'hireDateHijri',
  'jobTitleAr',
  'jobTitleEn',
  'department',
  'noDepartment',
  'branch',
  'noBranch',
  'manager',
  'managerHint',
  'managerHintAll',
  'noManager',
  'inactive',
  'allDepartmentsManagers',
  'departmentManagersOnly',
  'save',
  'saving',
  'saved',
  'noChanges',
  'backToProfile',
] as const;
const FIELD_ERROR_KEYS = [
  'required',
  'name',
  'mobile',
  'email',
  'emailTaken',
  'employeeNumber',
  'employeeNumberTaken',
  'managerLoop',
  'managerInactive',
  'managerSelf',
  'unit',
  'unitDeleted',
  'jobTitle',
  'hireOn',
  'hireOnAfterEnd',
] as const;

/**
 * Edit a user's details (T-M2-13, FR-IAM-01): HR Manager or Organization Admin; a privileged
 * member's record by the Organization Admin only. Out of scope or another organization → 404.
 */
export default async function EditUserPage({
  params,
}: {
  params: Promise<{ locale: string; personId: string }>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'editUser' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const profileHref = `/${locale}/suite/admin/users/${encodeURIComponent(personId)}`;

  let content: ReactNode;
  let name: string | null = null;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await editUserQuery({ personId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
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
      name = localizedName(
        locale,
        result.value.user.displayNameAr,
        result.value.user.displayNameEn,
      );
      content = await editForm(locale, result.value, profileHref);
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="users"
      path={`/suite/admin/users/${encodeURIComponent(personId)}/edit`}
    >
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={`/${locale}/suite/admin/users`}>{t('breadcrumb')}</a>
        {name ? (
          <>
            {' / '}
            <a href={profileHref}>{name}</a>
          </>
        ) : null}
      </nav>
      <h1 className="mb-6 mt-0 text-2xl font-bold">
        {name ? t('titleFor', { name }) : t('title')}
      </h1>
      {content}
    </SuiteShell>
  );
}

async function editForm(
  locale: 'ar' | 'en',
  view: EditUserView,
  profileHref: string,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'editUser' });
  const profile = await getTranslations({ locale, namespace: 'profile' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const { user } = view;
  const labels: Record<string, string> = Object.fromEntries(LABEL_KEYS.map((k) => [k, t(k)]));
  labels.required = common('required');
  labels.optional = common('optional');
  labels['part.firstName'] = profile('fields.firstName');
  labels['part.fatherName'] = profile('fields.fatherName');
  labels['part.grandfatherName'] = profile('fields.grandfatherName');
  labels['part.familyName'] = profile('fields.familyName');
  labels['language.ar'] = profile('languages.ar');
  labels['language.en'] = profile('languages.en');
  const fieldTexts: Record<string, string> = Object.fromEntries(
    FIELD_ERROR_KEYS.map((k) => [k, t(`fieldErrors.${k}`)]),
  );
  const unit = (u: { id: string; nameAr: string; nameEn: string | null }) => ({
    id: u.id,
    name: localizedName(locale, u.nameAr, u.nameEn),
  });
  // The current unit stays selectable even when deleted since (a save keeps it, never clears it).
  const withCurrent = (
    options: readonly { id: string; nameAr: string; nameEn: string | null }[],
    id: string | null,
    current: CurrentUnit | null,
  ) => {
    const list = options.map(unit);
    if (id === null || current === null || options.some((o) => o.id === id)) return list;
    const name = localizedName(locale, current.nameAr, current.nameEn);
    return [{ id, name: current.deleted ? `${name} ${t('deleted')}` : name }, ...list];
  };

  return (
    <Card title={t('details')}>
      <p className="mb-4 mt-0 text-text-muted">{t('intro')}</p>
      <EditUserForm
        locale={locale}
        personId={user.personId}
        version={user.version}
        names={formStateFrom(user)}
        values={{
          email: user.email ?? '',
          hasLogin: user.hasLogin,
          employeeNumber: user.employeeNumber ?? '',
          departmentId: user.departmentId ?? '',
          branchId: user.branchId ?? '',
          managerPersonId: user.managerPersonId ?? '',
          jobTitleAr: user.jobTitleAr ?? '',
          jobTitleEn: user.jobTitleEn ?? '',
          hireOn: user.hireOn ?? '',
        }}
        departments={withCurrent(view.orgUnits.departments, user.departmentId, user.department)}
        branches={withCurrent(view.orgUnits.branches, user.branchId, user.branch)}
        managers={view.managers.map((m) => ({
          personId: m.personId,
          name: localizedName(locale, m.nameAr, m.nameEn),
          active: m.active,
          departmentIds: m.departmentIds,
        }))}
        labels={labels}
        fieldTexts={fieldTexts}
        errors={await profileErrorTexts(locale)}
        profileHref={profileHref}
      />
    </Card>
  );
}
