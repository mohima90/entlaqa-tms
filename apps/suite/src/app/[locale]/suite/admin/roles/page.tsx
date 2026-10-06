import { toClientError } from '@jadarat/platform-core';
import { type AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type AccessLevel,
  ROLE_MATRIX,
  SYSTEM_ROLES,
  type SystemRoleDefinition,
} from '@jadarat/platform-rbac';
import { Alert, Badge, type BadgeTone, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../components/suite-shell';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { rolesPageQuery } from '../../../../../lib/users-queries';

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

/**
 * Roles & permissions (T-M2-05, FR-IAM-07; approved screen 5): the 14 system roles, read-only, with
 * the permission matrix of BRD Appendix B and how many members hold each role. Custom roles are R2.
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
  const requested = typeof query.role === 'string' ? query.role : '';
  const selected = SYSTEM_ROLES.find((r) => r.code === requested) ?? SYSTEM_ROLES[0];
  if (!selected) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <>
        <Alert tone="info" data-testid="roles-not-configured">
          {users('notConfigured')}
        </Alert>
        <Roles locale={locale} selected={selected} counts={null} />
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
      content = <Roles locale={locale} selected={selected} counts={result.value.memberCounts} />;
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="roles" path="/suite/admin/roles">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold">{t('title')}</h1>
          <p className="mb-0 mt-2 text-text-muted">{t('intro', { count: SYSTEM_ROLES.length })}</p>
        </div>
        <p className="m-0 flex items-center gap-2 text-text-muted" data-testid="custom-role">
          {t('customRole')} <Badge tone="neutral">{t('comingSoon')}</Badge>
        </p>
      </div>
      {content}
    </SuiteShell>
  );
}

async function Roles({
  locale,
  selected,
  counts,
}: {
  locale: AppLocale;
  selected: SystemRoleDefinition;
  counts: Readonly<Record<string, number>> | null;
}) {
  const t = await getTranslations({ locale, namespace: 'rolesPage' });
  const href = (code: string) => `/${locale}/suite/admin/roles?role=${code}`;
  const members = counts ? (counts[selected.code] ?? 0) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
      <nav aria-label={t('rolesLabel')}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="role-list">
          {SYSTEM_ROLES.map((role) => {
            const current = role.code === selected.code;
            return (
              <li key={role.code}>
                <a
                  href={href(role.code)}
                  aria-current={current ? 'true' : undefined}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-md px-3 py-2 no-underline ${
                    current
                      ? 'bg-surface-selected font-medium text-primary-text'
                      : 'text-text hover:bg-surface-hover'
                  }`}
                >
                  <span>{role.name[locale]}</span>
                  {counts ? (
                    <span className="text-sm text-text-muted">
                      <span className="sr-only">{t('membersLabel')} </span>
                      {counts[role.code] ?? 0}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <Card title={selected.name[locale]} data-testid="role-detail">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{t('systemRole')}</Badge>
            {selected.privileged ? <Badge tone="warning">{t('privileged')}</Badge> : null}
          </div>
          <p className="m-0">{selected.description[locale]}</p>
          {members !== null ? (
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span data-testid="role-members">{t('members', { count: members })}</span>
              {members > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={`/${locale}/suite/admin/users?role=${selected.code}`}>
                    {t('viewUsers')}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          <div>
            <h3 className="mb-2 mt-0 text-base font-semibold">{t('legendTitle')}</h3>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-sm">
              {LEGEND.map((level) => (
                <li key={level} className="flex items-center gap-2">
                  <Badge tone={LEVEL_TONE[level]}>{t(`levels.${level}`)}</Badge>
                  <span className="text-text-muted">{t(`levelHints.${level}`)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start" data-testid="role-matrix">
              <caption className="sr-only">
                {t('tableCaption', { role: selected.name[locale] })}
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-2 py-2 text-start font-semibold">
                    {t('columns.area')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold">
                    {t('columns.access')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold">
                    {t('columns.scope')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX.map((area) => {
                  const cell = area.access[selected.code];
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
    </div>
  );
}
