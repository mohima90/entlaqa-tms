import { toClientError } from '@jadarat/platform-core';
import type { StructureLevelRow } from '@jadarat/platform-db';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { StructurePageView } from '@jadarat/platform-rbac';
import { Alert, PageHeader, StatCard, StatGrid, TabNav } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { type LevelView, LevelsCard } from '../../../../../components/structure/levels-card';
import { StructureTree } from '../../../../../components/structure/structure-tree';
import type { UnitView } from '../../../../../components/structure/unit-dialog';
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
 * the HR Manager (`platform.org.manage`) changes it.
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
          <Alert tone="danger">
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
      <PageHeader title={t('title')} description={t('intro')} />
      <div className="flex flex-col gap-6">
        {content}
        {data ? <Structure locale={locale} view={view} data={data} /> : null}
      </div>
    </SuiteShell>
  );
}

async function Structure({
  locale,
  view,
  data,
}: {
  locale: AppLocale;
  view: View;
  data: StructurePageView;
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

  return (
    <>
      <StatGrid label={t('stats.label')} data-testid="structure-stats">
        <StatCard label={t('stats.levels')} value={number(data.levels.length)} icon="plan" />
        <StatCard label={t('stats.units')} value={number(data.units.length)} icon="structure" />
        <StatCard
          label={t('stats.withHead')}
          value={number(data.units.filter((u) => u.headPersonId !== null).length)}
          icon="user"
          tone="success"
        />
        <StatCard
          label={t('stats.inactive')}
          value={number(data.units.filter((u) => u.status !== 'active').length)}
          icon="warning"
          tone="warning"
        />
      </StatGrid>
      <TabNav
        label={t('tabsLabel')}
        current={view}
        items={VIEWS.map((key) => ({
          key,
          href: key === 'tree' ? `/${locale}${PATH}` : `/${locale}${PATH}?view=levels`,
          label: t(`tabs.${key}`),
          icon: key === 'tree' ? 'structure' : 'plan',
        }))}
        data-testid="structure-views"
      />
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
          errors={errors}
          locale={locale}
        />
      ) : (
        <LevelsCard
          levels={levels}
          canManage={data.canManage}
          maxLevels={MAX_LEVELS}
          texts={texts}
          errors={errors}
          locale={locale}
        />
      )}
    </>
  );
}
