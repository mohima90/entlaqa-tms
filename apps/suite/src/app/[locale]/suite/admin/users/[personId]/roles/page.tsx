import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import type { EditRolesView } from '@jadarat/platform-rbac';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import { EditRoleForm } from '../../../../../../../components/users/edit-role-form';
import {
  editRoleLabels,
  roleSelectTexts,
  scopeUnitTexts,
} from '../../../../../../../lib/role-texts';
import { scopeUnitChoices } from '../../../../../../../lib/structure-view';
import { roleOptions } from '../../../../../../../lib/role-choice';
import { profileErrorTexts } from '../../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
import { editRolesQuery, userProfileQuery } from '../../../../../../../lib/users-queries';
import { localizedName } from '../../../../../../../lib/users-view';

/**
 * Change a member's role (T-M2-14, FR-IAM-07/08; EP-ROLES — one role per person, standard or custom):
 * HR Manager (ordinary roles whose permissions they hold) or Organization Admin; privileged roles need an
 * authenticator code (PO decision D-IAM-01). The same form opens from the ⋯ menu on Team members. Out of
 * scope or another organization → 404.
 */
export default async function EditRolesPage({
  params,
}: {
  params: Promise<{ locale: string; personId: string }>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'editRoles' });
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
    const result = await editRolesQuery({ personId });
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
      // The name for the title and breadcrumb (the same authorization: user.read on this person).
      const profile = await userProfileQuery({ personId });
      if (profile.ok) {
        name = localizedName(
          locale,
          profile.value.profile.displayNameAr,
          profile.value.profile.displayNameEn,
        );
      }
      content = await rolesForm(locale, result.value, profileHref);
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="users"
      path={`/suite/admin/users/${encodeURIComponent(personId)}/roles`}
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

async function rolesForm(
  locale: 'ar' | 'en',
  view: EditRolesView,
  profileHref: string,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'editRoles' });
  if (view.blocked) {
    return (
      <Alert tone="info" data-testid="roles-blocked">
        {t(`blocked.${view.blocked}`)}
      </Alert>
    );
  }
  return (
    <Card title={t('roles')}>
      <EditRoleForm
        personId={view.role.personId}
        version={view.role.version}
        currentRole={view.role.roleCode}
        currentUnit={view.role.scopeUnitId}
        options={roleOptions(view.choices, locale)}
        selectTexts={await roleSelectTexts(locale)}
        scopeUnits={scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale)}
        unitTexts={await scopeUnitTexts(locale, view.scopeUnits.structureVisible)}
        labels={await editRoleLabels(locale)}
        errors={await profileErrorTexts(locale)}
        backHref={profileHref}
        idPrefix="edit-role"
      />
    </Card>
  );
}
