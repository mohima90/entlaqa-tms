import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RoleBuilderForm } from '../../../../../../components/roles/role-builder-form';
import { type BuilderValues, applyStart } from '../../../../../../lib/role-builder';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import {
  roleBuilderGroups,
  roleBuilderStarts,
  roleBuilderTexts,
} from '../../../../../../lib/role-builder-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';
import { roleEditorQuery } from '../../../../../../lib/users-queries';

const EMPTY: BuilderValues = {
  nameEn: '',
  nameAr: '',
  description: '',
  dataScope: 'organization',
  permissions: [],
};

/**
 * Create a role (FR-IAM-07; EP-ROLES, PO 17 Oct 2026): the Organization Admin names it, starts from a
 * blank role, a standard role or a template, ticks permissions and chooses the data it sees. Anyone else
 * is refused (`platform.role.manage`).
 */
export default async function NewRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'roleBuilder' });
  const roles = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const rolesHref = `/${locale}/suite/admin/roles`;

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="roles-not-configured">
        {roles('notConfigured')}
      </Alert>
    );
  } else {
    const result = await roleEditorQuery({});
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
      const groups = roleBuilderGroups(locale, result.value.heldPermissions);
      const starts = await roleBuilderStarts(locale);
      // «Create a role from it» on a standard role's page: that start chosen already.
      const start = starts.find((s) => s.value === from);
      content = (
        <RoleBuilderForm
          editing={null}
          initial={start ? applyStart(groups, EMPTY, start) : EMPTY}
          initialStart={start?.value ?? ''}
          groups={groups}
          starts={starts}
          texts={await roleBuilderTexts(locale)}
          errors={await profileErrorTexts(locale)}
          rolesHref={rolesHref}
          savedHref={`${rolesHref}?saved=1`}
          locale={locale}
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="roles" path="/suite/admin/roles/new">
      <nav aria-label={roles('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={rolesHref}>{roles('backToRoles')}</a>
      </nav>
      <h1 className="mb-2 mt-0 text-2xl font-bold">{t('titleNew')}</h1>
      <p className="mb-6 mt-0 text-text-muted">{t('intro')}</p>
      {content}
    </SuiteShell>
  );
}
