import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type AccessLevel,
  ROLE_MATRIX,
  type RoleDetailView,
  SYSTEM_ROLES,
  isSystemRoleCode,
  standardRoleScope,
} from '@jadarat/platform-rbac';
import {
  Alert,
  Badge,
  type BadgeTone,
  Card,
  Icon,
  PageHeader,
  TabNav,
  buttonClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DeleteRoleButton } from '../../../../../../components/roles/delete-role-button';
import { PermissionsView } from '../../../../../../components/roles/permissions-view';
import { RoleBuilderForm } from '../../../../../../components/roles/role-builder-form';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import type { BuilderScope } from '../../../../../../lib/role-builder';
import {
  roleBuilderGroups,
  roleBuilderTexts,
  roleViewGroups,
} from '../../../../../../lib/role-builder-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';
import { roleDetailQuery } from '../../../../../../lib/users-queries';

const LEVEL_TONE: Record<AccessLevel, BadgeTone> = {
  F: 'success',
  FA: 'success',
  E: 'info',
  A: 'info',
  AE: 'info',
  EA: 'info',
  V: 'neutral',
  O: 'neutral',
  U: 'neutral',
  N: 'neutral',
};
const LEGEND: readonly AccessLevel[] = ['F', 'E', 'A', 'V', 'O', 'U', 'N'];
const ROLE_CODE = /^[a-z][a-z_]{1,39}$|^custom_[0-9a-f]{12}$/;
type RoleTab = 'permissions' | 'scope' | 'across';

/**
 * One role (FR-IAM-07; EP-ROLES; redesign package 3 — Shopify, Langdock, Gusto). A standard role is view
 * only: the header (what it does, Standard / Privileged, its holders, «Create a role from it»), then the
 * tabs Permissions (each Allowed / Not allowed in words, with a search) · Data this role sees · What this
 * role does across the product (BRD Appendix B, access levels in words). A custom role: the same view, or —
 * for the Organization Admin — its edit form and «Delete role» (only when nobody holds it).
 */
export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale) || !ROLE_CODE.test(code)) notFound();
  const rawTab = (await searchParams).tab;
  const requested = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab: RoleTab = requested === 'scope' || requested === 'across' ? requested : 'permissions';
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const rolesHref = `/${locale}/suite/admin/roles`;

  let title: string | null = null;
  let header: ReactNode = null;
  let content: ReactNode;
  if (!context.live) {
    // Without the database: the standard roles still read (custom roles need it).
    if (!isSystemRoleCode(code)) notFound();
    const role = SYSTEM_ROLES.find((r) => r.code === code);
    if (!role) notFound();
    title = role.name[locale];
    const view = standardOnly(code);
    header = await roleHeader(locale, view);
    content = (
      <>
        <Alert tone="info" data-testid="roles-not-configured">
          {t('notConfigured')}
        </Alert>
        <RoleView locale={locale} view={view} tab={tab} />
      </>
    );
  } else {
    const result = await roleDetailQuery({ code });
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
      const view = result.value;
      title = view.role.name[locale];
      if (view.custom && view.canManage) {
        const builder = await getTranslations({ locale, namespace: 'roleBuilder' });
        header = (
          <PageHeader
            breadcrumbs={[{ label: t('backToRoles'), href: rolesHref }, { label: title }]}
            breadcrumbsLabel={t('breadcrumbLabel')}
            title={<span data-testid="role-title">{title}</span>}
            description={builder('intro')}
          />
        );
        content = <RoleEdit locale={locale} view={view} rolesHref={rolesHref} />;
      } else {
        header = await roleHeader(locale, view);
        content = <RoleView locale={locale} view={view} tab={tab} />;
      }
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="roles"
      path={`/suite/admin/roles/${code}${tab === 'permissions' ? '' : `?tab=${tab}`}`}
    >
      {header ?? (
        <PageHeader
          breadcrumbs={[
            { label: t('backToRoles'), href: rolesHref },
            { label: title ?? t('title') },
          ]}
          breadcrumbsLabel={t('breadcrumbLabel')}
          title={<span data-testid="role-title">{title ?? t('title')}</span>}
        />
      )}
      <div className="flex flex-col gap-5">{content}</div>
    </SuiteShell>
  );
}

/** A standard role as the page shows it without the database. */
function standardOnly(code: string): RoleDetailView {
  const role = SYSTEM_ROLES.find((r) => r.code === code);
  if (!role) throw new Error(`Unknown role ${code}`);
  return {
    role: {
      code: role.code,
      kind: 'standard',
      name: role.name,
      description: role.description,
      privileged: role.privileged,
      permissions: [...new Set(role.grants.map((g) => g.permission.code))],
      id: null,
      version: null,
    },
    custom: null,
    memberCount: null,
    canManage: false,
  };
}

/**
 * The data scope as the page names it: a custom role's own choice («A department» = one unit picked when
 * the role is given, EP-ORG); the Department Head's «Their departments» (the units they head).
 */
function scopeOf(view: RoleDetailView): BuilderScope | 'headed' {
  if (view.custom) return view.custom.dataScope;
  const role = SYSTEM_ROLES.find((r) => r.code === view.role.code);
  const scope = role ? standardRoleScope(role) : 'organization';
  return scope === 'departments' ? 'headed' : scope;
}

/** The role's header: tile, name, what it does, its tags and holders, «Create a role from it». */
async function roleHeader(locale: AppLocale, view: RoleDetailView): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const { role } = view;
  const name = role.name[locale];
  const standard = role.kind === 'standard';
  return (
    <PageHeader
      breadcrumbs={[
        { label: t('backToRoles'), href: `/${locale}/suite/admin/roles` },
        { label: name },
      ]}
      breadcrumbsLabel={t('breadcrumbLabel')}
      leading={
        <span
          aria-hidden="true"
          className={
            standard
              ? 'grid size-16 shrink-0 place-items-center rounded-[20px] bg-brand-gradient text-on-brand shadow-brand-glow'
              : 'grid size-16 shrink-0 place-items-center rounded-[20px] bg-primary-subtle text-2xl font-bold text-primary-text'
          }
        >
          {standard ? <Icon name="lock" className="size-6" /> : Array.from(name)[0]}
        </span>
      }
      title={<span data-testid="role-title">{name}</span>}
      description={
        <span className="flex flex-col gap-2.5" data-testid="role-detail">
          <span>{role.description ? role.description[locale] : t('noDescription')}</span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{t(`types.${role.kind}`)}</Badge>
            {role.privileged ? <Badge tone="info">{t('privileged')}</Badge> : null}
            {view.memberCount !== null ? (
              <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px]">
                <Icon name="people" className="size-3.5" />
                <span data-testid="role-members">{t('members', { count: view.memberCount })}</span>
                {view.memberCount > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <Link href={`/${locale}/suite/admin/users?role=${role.code}`}>
                      {t('viewUsers')}
                    </Link>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
      }
      actions={
        standard && view.canManage && role.code !== 'tenant_admin' ? (
          <Link
            href={`/${locale}/suite/admin/roles/new?from=standard:${role.code}`}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
            data-testid="role-copy"
          >
            <Icon name="plus" />
            {t('customFrom')}
          </Link>
        ) : null
      }
    />
  );
}

async function RoleView({
  locale,
  view,
  tab,
}: {
  locale: AppLocale;
  view: RoleDetailView;
  tab: RoleTab;
}) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const builder = await getTranslations({ locale, namespace: 'roleBuilder' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const { role } = view;
  const standard = role.kind === 'standard';
  const base = `/${locale}/suite/admin/roles/${role.code}`;
  const current: RoleTab = tab === 'across' && !standard ? 'permissions' : tab;
  const adminOnly = role.permissions.filter((code) =>
    ['platform.role.assign_privileged', 'platform.role.manage'].includes(code),
  );
  const scope = scopeOf(view);
  const tabs = [
    {
      key: 'permissions',
      href: base,
      label: t('permissionsTitle'),
      icon: 'key' as const,
      count: role.permissions.length,
    },
    { key: 'scope', href: `${base}?tab=scope`, label: t('dataScopeTitle'), icon: 'eye' as const },
    ...(standard
      ? [
          {
            key: 'across',
            href: `${base}?tab=across`,
            label: t('acrossProduct'),
            icon: 'plan' as const,
          },
        ]
      : []),
  ];

  let body: ReactNode;
  if (current === 'scope') {
    body = (
      <Card title={t('dataScopeTitle')}>
        <p className="m-0 font-semibold" data-testid="role-scope">
          {builder(`scopes.${scope}.label`)}
        </p>
        <p className="m-0 mt-1 text-sm text-text-muted">{builder(`scopes.${scope}.hint`)}</p>
      </Card>
    );
  } else if (current === 'across') {
    body = <RoleMatrix locale={locale} code={role.code} name={role.name[locale]} />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <PermissionsView
          groups={roleViewGroups(locale)}
          chosen={role.permissions}
          texts={{
            searchPermissions: t('searchPermissions'),
            allowed: t('allowed'),
            notAllowed: t('notAllowed'),
            highRisk: builder('highRisk'),
            countLabel: String(builder.raw('countLabel')),
            noMatches: users('noMatches'),
          }}
          locale={locale}
        />
        {adminOnly.length > 0 ? (
          <p className="m-0 text-sm text-text-muted">{t('adminOnlyGroup')}</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {standard ? (
        <Alert tone="info" data-testid="role-standard-note">
          {t('standardNote')}
        </Alert>
      ) : null}
      <TabNav variant="underline" label={role.name[locale]} items={tabs} current={current} />
      {body}
    </>
  );
}

async function RoleMatrix({
  locale,
  code,
  name,
}: {
  locale: AppLocale;
  code: string;
  name: string;
}) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  if (!isSystemRoleCode(code)) return null;
  const level = (value: AccessLevel) =>
    value === 'N' ? (
      <span className="text-text-muted">{t('levels.N')}</span>
    ) : (
      <Badge tone={LEVEL_TONE[value]}>{t(`levels.${value}`)}</Badge>
    );
  return (
    <Card title={t('acrossProduct')}>
      <div className="flex flex-col gap-4">
        {/* The levels are written in words in the table; their meanings stay one click away. */}
        <details className="rounded-md" data-testid="role-legend">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">
            {t('legendTitle')}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-sm">
            {LEGEND.map((entry) => (
              <li key={entry} className="flex items-center gap-2">
                {level(entry)}
                <span className="text-text-muted">{t(`levelHints.${entry}`)}</span>
              </li>
            ))}
          </ul>
        </details>
        {/* Scrolls on phones: focusable so the keyboard can scroll it too (WCAG 2.1.1; axe
            scrollable-region-focusable — the table itself has nothing focusable). */}
        <div
          className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
          tabIndex={0}
          role="region"
          aria-label={t('matrixCaption', { role: name })}
        >
          <table className="w-full border-collapse text-start" data-testid="role-matrix">
            <caption className="sr-only">{t('matrixCaption', { role: name })}</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-text-muted">
                <th scope="col" className="px-3 py-2.5 text-start font-bold">
                  {t('matrixColumns.area')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-bold">
                  {t('matrixColumns.access')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-bold">
                  {t('matrixColumns.scope')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROLE_MATRIX.map((area) => {
                const cell = area.access[code];
                return (
                  <tr key={area.key} className="border-b border-border">
                    <th scope="row" className="px-3 py-2.5 text-start font-normal">
                      <span className="flex flex-wrap items-center gap-2">
                        {area.name[locale]}
                        {area.sensitive ? <Badge tone="warning">{t('sensitive')}</Badge> : null}
                      </span>
                    </th>
                    <td className="px-3 py-2.5">{level(cell.level)}</td>
                    <td className="px-3 py-2.5 text-text-muted">
                      {cell.qualifier ? cell.qualifier[locale] : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="m-0 text-sm text-text-muted">{t('matrixNote')}</p>
      </div>
    </Card>
  );
}

async function RoleEdit({
  locale,
  view,
  rolesHref,
}: {
  locale: AppLocale;
  view: RoleDetailView;
  rolesHref: string;
}) {
  const custom = view.custom;
  if (!custom) return null;
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const builder = await getTranslations({ locale, namespace: 'roleBuilder' });
  const texts = await roleBuilderTexts(locale);
  const errors = await profileErrorTexts(locale);
  const held = custom.memberCount > 0 || custom.pendingInvitationCount > 0;
  return (
    <>
      <RoleBuilderForm
        editing={{ id: custom.id, version: custom.version }}
        initial={{
          nameEn: custom.nameEn,
          nameAr: custom.nameAr,
          description: custom.description ?? '',
          dataScope: custom.dataScope,
          permissions: custom.permissions,
        }}
        groups={roleBuilderGroups(locale)}
        starts={[]}
        texts={texts}
        errors={errors}
        rolesHref={rolesHref}
        locale={locale}
        holdersText={builder('holders', { count: custom.memberCount })}
      />
      <Card title={builder('delete')} data-testid="role-delete-card">
        <div className="flex flex-col gap-3">
          {held ? (
            <Alert tone="info" data-testid="role-in-use">
              {builder('inUse', {
                members: custom.memberCount,
                invitations: custom.pendingInvitationCount,
              })}
            </Alert>
          ) : (
            <>
              <p className="m-0 text-sm text-text-muted">{builder('deleteText')}</p>
              <div>
                <DeleteRoleButton
                  id={custom.id}
                  version={custom.version}
                  texts={{
                    ...texts,
                    deleteTitle: t('deleteTitle', {
                      name: custom[locale === 'ar' ? 'nameAr' : 'nameEn'],
                    }),
                  }}
                  errors={errors}
                  rolesHref={rolesHref}
                />
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
