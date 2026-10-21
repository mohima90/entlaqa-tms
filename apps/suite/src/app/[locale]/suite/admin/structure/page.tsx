import { toClientError } from '@jadarat/platform-core';
import type { StructureLevelRow } from '@jadarat/platform-db';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { StructurePageView } from '@jadarat/platform-rbac';
import { Alert, type Breadcrumb, Icon, PageHeader, TabNav, buttonClasses, cn } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { type LevelView, LevelsCard } from '../../../../../components/structure/levels-card';
import { StructureTree } from '../../../../../components/structure/structure-tree';
import type { UnitView } from '../../../../../components/structure/unit-panel';
import { SuiteShell } from '../../../../../components/suite-shell';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { structurePageQuery } from '../../../../../lib/structure-queries';
import { levelName, nextLevel } from '../../../../../lib/structure-view';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { localizedName } from '../../../../../lib/users-view';

const PATH = '/suite/admin/structure';
/** Ten levels at most (platform.structure_levels; MAX_STRUCTURE_LEVELS in platform-db). */
const MAX_LEVELS = 10;
const VIEWS = ['tree', 'levels'] as const;
type View = (typeof VIEWS)[number];

/** Before the database is connected: the default level every organization starts with (EP-ORG). */
const DEFAULT_LEVELS: readonly StructureLevelRow[] = [
  { id: 'default', ordinal: 1, nameEn: 'Department', nameAr: 'إدارة', version: 1, unitCount: 0 },
];

/**
 * Organization → Structure (FR-ADM-05, BRD v3.2; T-M3-02; business flow
 * docs/business-flows/EP-ORG-organization-structure.md, PO 17 Oct 2026; Kawadir's Departments page): summary
 * cards, then two views — the tree («Add <first level>», each row's menu «Add <next level>», edit, deactivate,
 * delete) and the organization's own levels. Everyone who reads the structure (`platform.org.read`) sees it;
 * the HR Manager (`platform.org.manage`) changes it. Direction C (redesign package 2, PO 21 Oct 2026):
 * breadcrumbs, a compact summary strip, the views «Units» and «Levels» (Q2-10) with the level chain
 * beside them, «+ Add» on each row, a side panel for the form and Undo after deactivating.
 */
export default async function StructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const query = await searchParams;
  const view: View = query.view === 'levels' ? 'levels' : 'tree';
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'structure' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const header = {
    title: t('title'),
    description: t('intro'),
    breadcrumbs: [
      { label: shell('groupOrganization') },
      { label: shell('structure') },
    ] as Breadcrumb[],
    breadcrumbsLabel: common('breadcrumbLabel'),
  };

  let content: ReactNode;
  let data: StructurePageView | null = null;
  if (!context.live) {
    data = { levels: DEFAULT_LEVELS, units: [], branches: [], people: [], canManage: false };
    content = (
      <Alert tone="info" data-testid="structure-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const result = await structurePageQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = <Alert tone="warning">{errors('forbidden')}</Alert>;
      } else {
        content = (
          <Alert
            tone="danger"
            data-testid="structure-load-failed"
            action={
              <a
                href={`/${locale}${PATH}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="sync" />
                {common('tryAgain')}
              </a>
            }
          >
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      data = result.value;
      content = data.canManage ? null : (
        <Alert tone="info" data-testid="structure-view-only">
          {t('viewOnly')}
        </Alert>
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="structure"
      path={view === 'levels' ? `${PATH}?view=levels` : PATH}
    >
      {data ? (
        <Structure locale={locale} view={view} data={data} header={header} notice={content} />
      ) : (
        <>
          <PageHeader {...header} />
          {content}
        </>
      )}
    </SuiteShell>
  );
}

async function Structure({
  locale,
  view,
  data,
  header,
  notice,
}: {
  locale: AppLocale;
  view: View;
  data: StructurePageView;
  header: Parameters<typeof StructureTree>[0]['header'];
  notice: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'structure' });
  const format = await getFormatter({ locale });
  const common = await getTranslations({ locale, namespace: 'common' });
  const texts: Record<string, string> = {
    ...flattenTexts(getMessages(locale).structure),
    required: common('required'),
    optional: common('optional'),
  };
  // Plural forms are formatted here (no i18n runtime in the browser).
  delete texts.childCount;
  delete texts['levels.inUse'];
  delete texts['levels.unitCount'];
  const errors = await profileErrorTexts(locale);
  const labels = data.levels.map(({ ordinal, nameEn, nameAr }) => ({ ordinal, nameEn, nameAr }));
  const number = (value: number) => format.number(value, 'integer');

  const levels: LevelView[] = data.levels.map((level) => ({
    id: level.id,
    ordinal: level.ordinal,
    nameEn: level.nameEn,
    nameAr: level.nameAr,
    name: locale === 'ar' ? level.nameAr : level.nameEn,
    version: level.version,
    unitCount: level.unitCount,
    unitCountLabel: t('levels.unitCount', { count: level.unitCount }),
    inUseLabel: t('levels.inUse', { units: level.unitCount }),
  }));
  const units: UnitView[] = data.units.map((unit) => ({
    id: unit.id,
    parentId: unit.parentId,
    code: unit.code,
    nameAr: unit.nameAr,
    nameEn: unit.nameEn,
    name: localizedName(locale, unit.nameAr, unit.nameEn),
    levelName: levelName(labels, unit.levelOrdinal, locale),
    nextLevelName: (() => {
      const next = nextLevel(labels, unit.levelOrdinal);
      return next ? (locale === 'ar' ? next.nameAr : next.nameEn) : null;
    })(),
    branchId: unit.branchId,
    headPersonId: unit.headPersonId,
    // A head may have an English name only (PO 17 Oct 2026).
    headName: unit.headPersonId ? localizedName(locale, unit.headNameAr, unit.headNameEn) : null,
    active: unit.status === 'active',
    version: unit.version,
    childCount: unit.childCount,
    childCountLabel: unit.childCount > 0 ? t('childCount', { count: unit.childCount }) : null,
    peopleCount: unit.peopleCount,
    roleScopeCount: unit.roleScopeCount,
  }));
  const first = labels[0];
  const inactive = data.units.filter((u) => u.status !== 'active').length;
  // A compact summary (no status colour without a status: amber only for inactive units, when any).
  const stats = [
    { key: 'levels', value: data.levels.length, warn: false },
    { key: 'units', value: data.units.length, warn: false },
    {
      key: 'withHead',
      value: data.units.filter((u) => u.headPersonId !== null).length,
      warn: false,
    },
    { key: 'inactive', value: inactive, warn: inactive > 0 },
  ] as const;
  const levelNames = data.levels.map((level) => (locale === 'ar' ? level.nameAr : level.nameEn));

  const top = (
    <>
      {notice}
      <section
        aria-label={t('stats.label')}
        className="rounded-xl border border-border bg-surface px-5 py-3.5"
        data-testid="structure-stats"
      >
        <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2">
          {stats.map((stat) => (
            <div key={stat.key} className="flex items-baseline gap-2">
              <dt className="order-2 text-text-muted">{t(`stats.${stat.key}`)}</dt>
              <dd
                className={cn(
                  'order-1 m-0 text-2xl font-bold tabular-nums',
                  stat.warn && 'text-warning',
                )}
              >
                {number(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-border">
        <TabNav
          variant="underline"
          label={t('tabsLabel')}
          current={view}
          className="-mb-px [&_ul]:border-b-0"
          items={VIEWS.map((key) => ({
            key,
            href: key === 'tree' ? `/${locale}${PATH}` : `/${locale}${PATH}?view=levels`,
            label: t(`tabs.${key}`),
            icon: key === 'tree' ? 'structure' : 'plan',
          }))}
          data-testid="structure-views"
        />
        {levelNames.length > 0 ? (
          <p
            className="m-0 flex flex-wrap items-center gap-1.5 pb-2.5 text-sm text-text-muted"
            data-testid="structure-chain"
          >
            <span>{t('levels.caption')}:</span>
            {levelNames.map((name, index) => (
              <span key={index} className="flex items-center gap-1.5">
                {index > 0 ? (
                  <Icon name="arrow-end" className="size-3.5" aria-hidden="true" />
                ) : null}
                <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-semibold text-text">
                  {name}
                </span>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      {view === 'tree' ? (
        <StructureTree
          units={units}
          canManage={data.canManage}
          firstLevelName={first ? (locale === 'ar' ? first.nameAr : first.nameEn) : null}
          branches={data.branches.map((b) => ({
            value: b.id,
            label: localizedName(locale, b.nameAr, b.nameEn),
          }))}
          people={data.people.map((p) => ({
            value: p.id,
            label: p.employeeNumber
              ? `${localizedName(locale, p.nameAr, p.nameEn)} · ${p.employeeNumber}`
              : localizedName(locale, p.nameAr, p.nameEn),
          }))}
          texts={texts}
          undoLabel={(await getTranslations({ locale, namespace: 'common' }))('undo')}
          errors={errors}
          locale={locale}
          header={header}
          top={top}
          levelsHref={`/${locale}${PATH}?view=levels`}
        />
      ) : (
        <>
          <PageHeader {...header} />
          <div className="mb-5 flex flex-col gap-5">{top}</div>
          <LevelsCard
            levels={levels}
            canManage={data.canManage}
            maxLevels={MAX_LEVELS}
            texts={texts}
            errors={errors}
            locale={locale}
          />
        </>
      )}
    </>
  );
}
