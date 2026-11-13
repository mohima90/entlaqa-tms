import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CyclesListView } from '@jadarat/tms';
import { dayInZone, defaultDeadline, defaultPeriod } from '@jadarat/tms/planning-model';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  type CyclesOpen,
  CyclesScreen,
  type NeedsFormChoice,
} from '../../../../../components/planning/cycles-screen';
import { PlanningHeader } from '../../../../../components/planning/planning-header';
import { RefreshOnReturn } from '../../../../../components/latest-version';
import { SuiteShell } from '../../../../../components/suite-shell';
import {
  planCyclesListQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../lib/planning-queries';
import {
  PLANNING_PATHS,
  listFilter,
  localName,
  pickerUnits,
} from '../../../../../lib/planning-view';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';

const PATH = PLANNING_PATHS.cycles;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The popup the address asks for: `?new=1`, `?edit=<cycle>` or `?launch=<cycle>` (old links land here). */
function openFrom(query: Record<string, string | string[] | undefined>): CyclesOpen {
  if (query.new === '1') return { kind: 'new' };
  if (typeof query.edit === 'string' && UUID_RE.test(query.edit)) {
    return { kind: 'edit', id: query.edit };
  }
  if (typeof query.launch === 'string' && UUID_RE.test(query.launch)) {
    return { kind: 'launch', id: query.launch };
  }
  return null;
}

/**
 * Planning → Cycles (EP-PLN screen 3; the Kawadir pattern — forms standard rule 9, WP-UX-01 a / T-M3-20):
 * the page header with «New cycle», the summary cards that filter the table, the cycles in a table and the
 * popups that create, edit, launch and delete a draft (components/planning/cycles-screen.tsx). The L&D
 * Manager starts and changes cycles; the Training Coordinator follows them (read only). Everyone else is
 * refused (deny by default).
 */
export default async function PlanningCyclesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const query = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planning' });

  let content: ReactNode;
  if (!context.live) {
    // The preview without data: the screen as the L&D Manager sees it before the first cycle, with the
    // platform's suggestions in the popup (creating needs the database).
    const today = dayInZone(new Date(), context.regional.timeZone);
    const period = defaultPeriod(today, 1);
    content = await screen(locale, context, query, {
      today: '',
      cycles: [],
      counts: { all: 0, draft: 0, open: 0, closed: 0 },
      canManage: true,
      setup: {
        defaults: {
          periodStart: period.start,
          periodEnd: period.end,
          deadline: defaultDeadline(today, period.end),
        },
        nameLanguage: 'en',
        units: [],
        branches: [],
        levels: [],
        needsForms: [],
      },
    });
    content = (
      <>
        <Alert tone="info" className="mb-5" data-testid="planning-not-configured">
          {t('list.notConfigured')}
        </Alert>
        {content}
      </>
    );
  } else {
    const result = await planCyclesListQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content = (
        <>
          <PlanningHeader
            locale={locale}
            title={t('list.title')}
            description={t('list.intro')}
            withCycles={false}
          />
          {error.code === 'FORBIDDEN' ? (
            <Alert tone="warning" data-testid="planning-forbidden">
              {errors('forbidden')}
            </Alert>
          ) : (
            <Alert tone="danger">
              {t('list.loadFailed', { correlationId: error.correlationId ?? '' })}
            </Alert>
          )}
        </>
      );
    } else {
      content = await screen(locale, context, query, result.value);
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={PATH}>
      {content}
      <RefreshOnReturn />
    </SuiteShell>
  );
}

/** The list with its popups, from the view and the address. */
async function screen(
  locale: AppLocale,
  context: SuiteContext,
  query: Record<string, string | string[] | undefined>,
  view: CyclesListView,
) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const form = (
    f: NonNullable<CyclesListView['setup']>['needsForms'][number],
  ): NeedsFormChoice => ({
    id: f.id,
    name: localName(locale, f.name),
    active: f.active,
    isDefault: f.isDefault,
  });
  return (
    <CyclesScreen
      locale={locale}
      header={{
        title: t('list.title'),
        description: t('list.intro'),
        breadcrumbsLabel: t('breadcrumb.label'),
        breadcrumbs: [{ label: t('breadcrumb.planning') }, { label: t('list.title') }],
      }}
      today={view.today}
      cycles={view.cycles.map((cycle) => ({
        id: cycle.id,
        name: localName(locale, cycle.name),
        nameAr: cycle.name.ar,
        nameEn: cycle.name.en,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        deadline: cycle.deadline,
        status: cycle.status,
        departmentCount: cycle.departmentCount,
        submittedCount: cycle.submittedCount,
        draft: cycle.draft
          ? {
              ...cycle.draft,
              needsFormOff: cycle.draft.needsFormOff ? form(cycle.draft.needsFormOff) : null,
            }
          : null,
      }))}
      filter={listFilter(query.status)}
      counts={view.counts}
      canManage={view.canManage}
      setup={
        view.setup
          ? {
              defaults: view.setup.defaults,
              nameLanguage: view.setup.nameLanguage,
              units: pickerUnits(locale, view.setup.units, view.setup.levels, (name, unit) =>
                t('cycle.headVia', { name, unit }),
              ),
              branches: view.setup.branches.map((branch) => ({
                id: branch.id,
                name: localName(locale, branch.name),
                active: branch.active,
              })),
              needsForms: view.setup.needsForms.map(form),
            }
          : null
      }
      open={openFrom(query)}
      canPickHeads={context.navigation.structure}
      display={context.regional.dateDisplay}
      needsFormsLabel={shell('needsForms')}
      texts={planningTexts(locale)}
      errors={await planningErrorTexts(locale)}
    />
  );
}
