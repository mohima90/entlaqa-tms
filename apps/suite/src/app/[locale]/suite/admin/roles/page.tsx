import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type RolesPageRole,
  type RolesPageView,
  SYSTEM_ROLES,
  standardAssignableRole,
} from '@jadarat/platform-rbac';
import { Alert, Badge, Card, Icon, PageHeader, buttonClasses, tableClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DeleteRoleButton } from '../../../../../components/roles/delete-role-button';
import { SuiteShell } from '../../../../../components/suite-shell';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { roleBuilderTexts } from '../../../../../lib/role-builder-texts';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { rolesPageQuery } from '../../../../../lib/users-queries';

/** The standard roles without the database (an environment not connected yet). */
const STANDARD_ONLY: RolesPageView = {
  roles: SYSTEM_ROLES.map((role) => ({
    code: role.code,
    kind: 'standard',
    name: role.name,
    description: role.description,
    privileged: role.privileged,
    permissions: standardAssignableRole(role.code)?.permissions ?? [],
    id: null,
    version: null,
  })),
  memberCounts: null,
  canManage: false,
};

/**
 * Roles & permissions (T-M2-05, FR-IAM-07; EP-ROLES, PO 17 Oct 2026 — Kawadir's roles table): the six
 * standard roles (view only) and the organization's custom roles, each with its type, number of
 * permissions and of people; «إنشاء دور», edit and delete for the Organization Admin.
 */
export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const query = await searchParams;
  // Links from before EP-ROLES (`?role=code`) open the role's own page.
  if (typeof query.role === 'string') {
    if (/^[a-z][a-z_]{1,39}$|^custom_[0-9a-f]{12}$/.test(query.role)) {
      redirect(`/${locale}/suite/admin/roles/${query.role}`);
    }
    redirect(`/${locale}/suite/admin/roles`);
  }
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  let canManage = false;
  if (!context.live) {
    content = (
      <>
        <Alert tone="info" data-testid="roles-not-configured">
          {t('notConfigured')}
        </Alert>
        <RolesTable locale={locale} view={STANDARD_ONLY} />
      </>
    );
  } else {
    const result = await rolesPageQuery({});
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
      canManage = result.value.canManage;
      content = (
        <>
          {query.saved === '1' ? (
            <Alert tone="success" data-testid="role-saved">
              {t('saved')}
            </Alert>
          ) : null}
          {query.deleted === '1' ? (
            <Alert tone="success" data-testid="role-deleted">
              {t('deleted')}
            </Alert>
          ) : null}
          <RolesTable locale={locale} view={result.value} />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="roles" path="/suite/admin/roles">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          canManage ? (
            <a
              href={`/${locale}/suite/admin/roles/new`}
              className={buttonClasses({ variant: 'primary', size: 'md' })}
              data-testid="create-role-link"
            >
              <Icon name="plus" />
              {t('createRole')}
            </a>
          ) : null
        }
      />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}

async function RolesTable({ locale, view }: { locale: AppLocale; view: RolesPageView }) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const counts = view.memberCounts;
  const builderTexts = view.canManage ? await roleBuilderTexts(locale) : null;
  const errors = view.canManage ? await profileErrorTexts(locale) : null;
  const roleHref = (role: RolesPageRole) => `/${locale}/suite/admin/roles/${role.code}`;

  return (
    <Card
      flush
      title={t('rolesCardTitle')}
      description={t('rolesCardDescription')}
      data-testid="roles-card"
    >
      <div className={tableClasses.wrapper}>
        <table className={tableClasses.table} data-testid="roles-table">
          <caption className="sr-only">{t('tableCaption')}</caption>
          <thead className={tableClasses.header}>
            <tr>
              <th scope="col" className={tableClasses.head}>
                {t('columns.role')}
              </th>
              <th scope="col" className={tableClasses.head}>
                {t('columns.description')}
              </th>
              <th scope="col" className={tableClasses.head}>
                {t('columns.type')}
              </th>
              <th scope="col" className={tableClasses.head}>
                {t('columns.permissions')}
              </th>
              {counts ? (
                <th scope="col" className={tableClasses.head}>
                  {t('columns.people')}
                </th>
              ) : null}
              <th scope="col" className={`${tableClasses.head} text-end`}>
                {t('columns.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((role) => {
              const name = role.name[locale];
              const people = counts ? (counts[role.code] ?? 0) : null;
              const editable = view.canManage && role.kind === 'custom';
              return (
                <tr
                  key={role.code}
                  className={tableClasses.row}
                  data-testid={`role-row-${role.code}`}
                >
                  <td className={tableClasses.cell}>
                    <div className="flex items-center gap-2">
                      <Icon
                        name={role.kind === 'standard' ? 'shield' : 'shield-outline'}
                        className={role.kind === 'standard' ? 'text-primary' : 'text-text-muted'}
                      />
                      <a href={roleHref(role)} className="font-medium">
                        {name}
                      </a>
                      {role.privileged ? <Badge tone="warning">{t('privileged')}</Badge> : null}
                    </div>
                  </td>
                  <td className={`${tableClasses.cell} max-w-xs`}>
                    {role.description ? (
                      <span className="line-clamp-2 text-text-muted">
                        {role.description[locale]}
                      </span>
                    ) : (
                      <span className="text-text-muted">{t('noDescription')}</span>
                    )}
                  </td>
                  <td className={tableClasses.cell}>
                    <Badge tone={role.kind === 'standard' ? 'info' : 'neutral'}>
                      {t(`types.${role.kind}`)}
                    </Badge>
                  </td>
                  <td className={tableClasses.cell}>
                    <Badge tone="neutral">
                      {t('permissionCount', { count: role.permissions.length })}
                    </Badge>
                  </td>
                  {people !== null ? (
                    <td className={tableClasses.cell} data-testid="role-people">
                      {people > 0 ? (
                        <a href={`/${locale}/suite/admin/users?role=${role.code}`}>
                          {t('members', { count: people })}
                        </a>
                      ) : (
                        <span className="text-text-muted">{t('members', { count: 0 })}</span>
                      )}
                    </td>
                  ) : null}
                  <td className={`${tableClasses.cell} text-end`}>
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={roleHref(role)}
                        className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                        aria-label={editable ? t('editRole', { name }) : t('viewRole', { name })}
                        data-testid={editable ? 'role-edit' : 'role-view'}
                      >
                        <Icon name={editable ? 'pencil' : 'lock'} />
                      </a>
                      {editable &&
                      builderTexts &&
                      errors &&
                      role.id &&
                      role.version !== null &&
                      people === 0 ? (
                        <DeleteRoleButton
                          id={role.id}
                          version={role.version}
                          texts={{ ...builderTexts, deleteTitle: t('deleteTitle', { name }) }}
                          errors={errors}
                          deletedHref={`/${locale}/suite/admin/roles?deleted=1`}
                          label={t('deleteRole', { name })}
                          compact
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
