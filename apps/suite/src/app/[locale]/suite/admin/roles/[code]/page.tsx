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
  ChecklistAccordion,
  Icon,
  buttonClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DeleteRoleButton } from '../../../../../../components/roles/delete-role-button';
import { RoleBuilderForm } from '../../../../../../components/roles/role-builder-form';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import type { BuilderScope } from '../../../../../../lib/role-builder';
import { roleBuilderGroups, roleBuilderTexts } from '../../../../../../lib/role-builder-texts';
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

/**
 * One role (FR-IAM-07; EP-ROLES, PO 17 Oct 2026). A standard role is view only: its permissions (the
 * accordion, read-only), the data it sees and what it does across the product (BRD Appendix B), with
 * «create a role from it». A custom role: the same view, or — for the Organization Admin — its edit form
 * and «delete» (only when nobody holds it).
 */
export default async function RolePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale) || !ROLE_CODE.test(code)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const rolesHref = `/${locale}/suite/admin/roles`;

  let title: string | null = null;
  let content: ReactNode;
  if (!context.live) {
    // Without the database: the standard roles still read (custom roles need it).
    if (!isSystemRoleCode(code)) notFound();
    const role = SYSTEM_ROLES.find((r) => r.code === code);
    if (!role) notFound();
    title = role.name[locale];
    content = (
      <>
        <Alert tone="info" data-testid="roles-not-configured">
          {t('notConfigured')}
        </Alert>
        <RoleView locale={locale} view={standardOnly(code)} />
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
      content =
        view.custom && view.canManage ? (
          <RoleEdit locale={locale} view={view} rolesHref={rolesHref} />
        ) : (
          <RoleView locale={locale} view={view} />
        );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="roles"
      path={`/suite/admin/roles/${code}`}
    >
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={rolesHref}>{t('backToRoles')}</a>
      </nav>
      <h1 className="mb-6 mt-0 text-2xl font-bold" data-testid="role-title">
        {title ?? t('title')}
      </h1>
      <div className="flex flex-col gap-6">{content}</div>
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
    heldPermissions: [],
  };
}

function scopeOf(view: RoleDetailView): BuilderScope {
  if (view.custom) return view.custom.dataScope;
  const role = SYSTEM_ROLES.find((r) => r.code === view.role.code);
  return role ? standardRoleScope(role) : 'organization';
}

async function RoleView({ locale, view }: { locale: AppLocale; view: RoleDetailView }) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const builder = await getTranslations({ locale, namespace: 'roleBuilder' });
  const { role } = view;
  const chosen = new Set(role.permissions);
  // Every catalogue permission is shown (read-only); the Organization Admin's own permissions too.
  const groups = roleBuilderGroups(locale, []).map((group) => ({
    key: group.key,
    title: group.title,
    items: group.permissions.map((permission) => ({
      value: permission.code,
      label: permission.label,
      description: permission.description,
      badge: permission.highRisk ? <Badge tone="warning">{builder('highRisk')}</Badge> : undefined,
      checked: chosen.has(permission.code),
    })),
  }));
  const adminOnly = role.permissions.filter((code) =>
    ['platform.role.assign_privileged', 'platform.role.manage'].includes(code),
  );
  const scope = scopeOf(view);
  const standard = role.kind === 'standard';

  return (
    <>
      <Card data-testid="role-detail">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={standard ? 'info' : 'neutral'}>{t(`types.${role.kind}`)}</Badge>
            {role.privileged ? <Badge tone="warning">{t('privileged')}</Badge> : null}
          </div>
          <p className="m-0">{role.description ? role.description[locale] : t('noDescription')}</p>
          {view.memberCount !== null ? (
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span data-testid="role-members">{t('members', { count: view.memberCount })}</span>
              {view.memberCount > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={`/${locale}/suite/admin/users?role=${role.code}`}>{t('viewUsers')}</a>
                </>
              ) : null}
            </p>
          ) : null}
          {standard ? (
            <Alert tone="info" data-testid="role-standard-note">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 basis-64">{t('standardNote')}</span>
                {view.canManage && role.code !== 'tenant_admin' ? (
                  <a
                    href={`/${locale}/suite/admin/roles/new?from=standard:${role.code}`}
                    className={buttonClasses({ variant: 'secondary', size: 'md' })}
                    data-testid="role-copy"
                  >
                    <Icon name="plus" />
                    {t('customFrom')}
                  </a>
                ) : null}
              </div>
            </Alert>
          ) : null}
        </div>
      </Card>

      <Card title={t('dataScopeTitle')}>
        <p className="m-0 font-medium" data-testid="role-scope">
          {builder(`scopes.${scope}.label`)}
        </p>
        <p className="m-0 text-sm text-text-muted">{builder(`scopes.${scope}.hint`)}</p>
      </Card>

      <Card title={t('permissionsTitle')}>
        <div className="flex flex-col gap-3">
          <ChecklistAccordion
            groups={groups}
            readOnly
            countLabel={String(builder.raw('countLabel'))}
            idPrefix="role-view-permission"
            data-testid="role-permissions"
          />
          {adminOnly.length > 0 ? (
            <p className="m-0 text-sm text-text-muted">{t('adminOnlyGroup')}</p>
          ) : null}
        </div>
      </Card>

      {standard ? <RoleMatrix locale={locale} code={role.code} name={role.name[locale]} /> : null}
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
  return (
    <Card title={t('acrossProduct')}>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-2 mt-0 text-base font-semibold">{t('legendTitle')}</h3>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-sm">
            {LEGEND.map((level) => (
              <li key={level} className="flex items-center gap-2">
                {level === 'N' ? (
                  <span className="text-text-muted">{t('levels.N')}</span>
                ) : (
                  <Badge tone={LEVEL_TONE[level]}>{t(`levels.${level}`)}</Badge>
                )}
                <span className="text-text-muted">{t(`levelHints.${level}`)}</span>
              </li>
            ))}
          </ul>
        </div>
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
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-2 text-start font-semibold">
                  {t('matrixColumns.area')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">
                  {t('matrixColumns.access')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">
                  {t('matrixColumns.scope')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROLE_MATRIX.map((area) => {
                const cell = area.access[code];
                return (
                  <tr key={area.key} className="border-b border-border">
                    <th scope="row" className="px-2 py-2 text-start font-normal">
                      <span className="flex flex-wrap items-center gap-2">
                        {area.name[locale]}
                        {area.sensitive ? <Badge tone="warning">{t('sensitive')}</Badge> : null}
                      </span>
                    </th>
                    <td className="px-2 py-2">
                      {cell.level === 'N' ? (
                        <span className="text-text-muted">{t('levels.N')}</span>
                      ) : (
                        <Badge tone={LEVEL_TONE[cell.level]}>{t(`levels.${cell.level}`)}</Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 text-text-muted">
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
      <p className="m-0 text-text-muted">{builder('intro')}</p>
      <RoleBuilderForm
        editing={{ id: custom.id, version: custom.version }}
        initial={{
          nameEn: custom.nameEn,
          nameAr: custom.nameAr,
          description: custom.description ?? '',
          dataScope: custom.dataScope,
          permissions: custom.permissions,
        }}
        groups={roleBuilderGroups(locale, view.heldPermissions)}
        starts={[]}
        texts={texts}
        errors={errors}
        rolesHref={rolesHref}
        savedHref={`${rolesHref}?saved=1`}
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
                  deletedHref={`${rolesHref}?deleted=1`}
                />
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
