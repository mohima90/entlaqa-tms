import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type RolesPageRole,
  type RolesPageView,
  SYSTEM_ROLES,
  standardAssignableRole,
} from '@jadarat/platform-rbac';
import { Alert, Badge, EmptyState, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RoleRowMenu } from '../../../../../components/roles/delete-role-button';
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
 * Roles & permissions (T-M2-05, FR-IAM-07; EP-ROLES; redesign package 3 — OpenAI Platform, Airwallex,
 * WorkOS): two groups — the six standard roles (view only, «Create a role from it») and the organization's
 * custom roles (edit, delete when nobody holds them) — as rows with what each role does, its permissions
 * and how many people hold it (a link to them on Team members). Create, edit and delete for the
 * Organization Admin, as before.
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
        <RolesList locale={locale} view={STANDARD_ONLY} />
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
      content = <RolesList locale={locale} view={result.value} />;
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="roles" path="/suite/admin/roles">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          canManage ? (
            <Link
              href={`/${locale}/suite/admin/roles/new`}
              className={buttonClasses({ variant: 'primary', size: 'md' })}
              data-testid="create-role-link"
            >
              <Icon name="plus" />
              {t('createRole')}
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-7">{content}</div>
    </SuiteShell>
  );
}

async function RolesList({ locale, view }: { locale: AppLocale; view: RolesPageView }) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const format = await getFormatter({ locale });
  const counts = view.memberCounts;
  const builderTexts = view.canManage ? await roleBuilderTexts(locale) : null;
  const errors = view.canManage ? await profileErrorTexts(locale) : null;
  const rolesHref = `/${locale}/suite/admin/roles`;
  const standard = view.roles.filter((r) => r.kind === 'standard');
  const custom = view.roles.filter((r) => r.kind === 'custom');

  const row = (role: RolesPageRole) => {
    const name = role.name[locale];
    const people = counts ? (counts[role.code] ?? 0) : null;
    const editable = view.canManage && role.kind === 'custom';
    const href = `${rolesHref}/${role.code}`;
    return (
      <li
        key={role.code}
        className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-4 last:border-b-0"
        data-testid={`role-row-${role.code}`}
      >
        <span
          aria-hidden="true"
          className={
            role.kind === 'standard'
              ? 'grid size-11 shrink-0 place-items-center rounded-md bg-brand-gradient text-on-brand'
              : 'grid size-11 shrink-0 place-items-center rounded-md bg-primary-subtle font-bold text-primary-text'
          }
        >
          {role.kind === 'standard' ? <Icon name="lock" /> : Array.from(name)[0]}
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href} className="font-semibold text-text">
              {name}
            </Link>
            {role.privileged ? (
              <Badge tone="info" data-testid="role-privileged">
                {t('privileged')}
              </Badge>
            ) : null}
          </div>
          <p className="m-0 mt-0.5 text-sm text-text-muted">
            {role.description ? role.description[locale] : t('noDescription')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{t('permissionCount', { count: role.permissions.length })}</Badge>
          {people !== null ? (
            people > 0 ? (
              <Link
                href={`/${locale}/suite/admin/users?role=${role.code}`}
                className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] font-medium text-text no-underline hover:bg-surface-hover"
                data-testid="role-people"
              >
                <Icon name="people" className="size-3.5" />
                {t('members', { count: people })}
              </Link>
            ) : (
              <span
                className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] text-text-muted"
                data-testid="role-people"
              >
                <Icon name="people" className="size-3.5" />
                {t('members', { count: 0 })}
              </span>
            )
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-1.5">
          <Link
            href={href}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            aria-label={editable ? t('editRole', { name }) : t('viewRole', { name })}
            data-testid={editable ? 'role-edit' : 'role-view'}
          >
            {editable ? <Icon name="pencil" className="size-4" /> : null}
            {editable ? builderTexts?.titleEdit : t('view')}
          </Link>
          {view.canManage && builderTexts && errors ? (
            <RoleRowMenu
              label={t('moreFor', { name })}
              createFrom={
                role.kind === 'standard' && role.code !== 'tenant_admin'
                  ? {
                      label: t('customFrom'),
                      href: `${rolesHref}/new?from=standard:${role.code}`,
                    }
                  : null
              }
              remove={
                editable && role.id && role.version !== null
                  ? {
                      id: role.id,
                      version: role.version,
                      texts: { ...builderTexts, deleteTitle: t('deleteTitle', { name }) },
                      errors,
                      rolesHref,
                    }
                  : null
              }
              inUse={people === null || people > 0}
            />
          ) : null}
        </div>
      </li>
    );
  };

  const group = (
    key: 'standard' | 'custom',
    roles: readonly RolesPageRole[],
    description: string,
    empty: ReactNode,
  ) => (
    <section aria-labelledby={`roles-${key}`} data-testid={`roles-${key}`}>
      <h2 id={`roles-${key}`} className="m-0 flex items-baseline gap-2 text-[22px] font-bold">
        {t(`types.${key}`)}
        <span className="text-base font-medium text-text-muted">
          {format.number(roles.length, 'integer')}
        </span>
      </h2>
      <p className="m-0 mb-3.5 mt-1 text-sm text-text-muted">{description}</p>
      {roles.length > 0 ? (
        <ul
          className="m-0 list-none overflow-hidden rounded-xl border border-border bg-surface p-0"
          data-testid={key === 'standard' ? 'roles-table' : undefined}
        >
          {roles.map(row)}
        </ul>
      ) : (
        empty
      )}
    </section>
  );

  return (
    <>
      {group('standard', standard, t('standardNote'), null)}
      {view.memberCounts !== null || custom.length > 0
        ? group(
            'custom',
            custom,
            t('rolesCardDescription'),
            <div
              className="rounded-xl border border-border bg-surface"
              data-testid="roles-no-custom"
            >
              <EmptyState
                icon="key"
                title={t('noCustomTitle')}
                description={t('noCustomBody')}
                action={
                  view.canManage ? (
                    <Link
                      href={`${rolesHref}/new`}
                      className={buttonClasses({ variant: 'primary', size: 'md' })}
                    >
                      <Icon name="plus" />
                      {t('createRole')}
                    </Link>
                  ) : undefined
                }
              />
            </div>,
          )
        : null}
    </>
  );
}
