import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, type IconName, TabNav } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LaunchCycleButton } from '../../../../../../../components/planning/cycle-action-buttons';
import {
  type CycleBasics,
  CycleDepartmentsForm,
  CycleInstructionsForm,
  CycleNeedsFormForm,
  CycleRemindersForm,
} from '../../../../../../../components/planning/cycle-settings-forms';
import { PlanningHeader } from '../../../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import { dayFormatter } from '../../../../../../../lib/planning-format';
import {
  planCycleQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../../../lib/planning-queries';
import {
  CYCLE_TONE,
  PLANNING_PATHS,
  SETTINGS_TABS,
  type SettingsTab,
  cycleHref,
  cycleSettingsHref,
  cyclesHref,
  localName,
  pickerUnits,
  settingsTab,
} from '../../../../../../../lib/planning-view';
import {
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../../../lib/structure-view';
import { getSuiteContext } from '../../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB_ICON: Readonly<Record<SettingsTab, IconName>> = {
  departments: 'structure',
  instructions: 'info',
  reminders: 'bell',
  form: 'flag',
};

/**
 * A draft cycle's Settings (the Kawadir pattern — forms standard rule 9; WP-UX-01 a, T-M3-20; FR-PLN-02):
 * everything that is optional when a cycle is created, on the cycle's own page — its sections as tabs at
 * the side («Departments & budgets», «Instructions to heads», «Reminders», «Needs form»; each its own
 * address), one save bar for the open section, and «Launch cycle» in the header. Only the member who may
 * change the draft (tms.plan_cycle.manage) sees it: a launched cycle, or a reader, goes to the cycle's page.
 */
export default async function CycleSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; cycleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, cycleId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(cycleId)) notFound();
  const query = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planning' });
  const tab = settingsTab(query.tab);
  const path = `${PLANNING_PATHS.cycles}/${cycleId}/settings`;

  let title = t('cycleSettings.tabsLabel');
  let description: ReactNode;
  let actions: ReactNode = null;
  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="planning-not-configured">
        {t('list.notConfigured')}
      </Alert>
    );
  } else {
    const result = await planCycleQuery({ id: cycleId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="planning-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('list.loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const view = result.value;
      // Settings change only while the cycle is a draft, by the member who manages cycles.
      if (!view.editable || !view.setup) redirect(cycleHref(locale, cycleId));
      const shell = await getTranslations({ locale, namespace: 'shell' });
      const texts = planningTexts(locale);
      const errors = await planningErrorTexts(locale);
      const day = dayFormatter(locale, context.regional.dateDisplay);
      const cycle = { id: view.cycle.id, version: view.cycle.version };
      title = localName(locale, { ar: view.cycle.nameAr, en: view.cycle.nameEn });
      // The organization's own level names (guided-test feedback #3): the column is named after the first
      // level, or the general word with each row's level when levels mix.
      const ordinals = view.departments.map((d) => d.levelOrdinal);
      const withLevels = showsUnitLevels(view.levels, ordinals);
      const headVia = (name: string, unit: string) => t('cycle.headVia', { name, unit });
      const rows = view.departments.map((d) => ({
        departmentId: d.departmentId,
        name: unitNameWithLevel(
          localName(locale, d.name),
          d.levelOrdinal,
          view.levels,
          locale,
          withLevels,
        ),
        head: d.head
          ? d.head.via
            ? headVia(localName(locale, d.head.name), localName(locale, d.head.via))
            : localName(locale, d.head.name)
          : null,
        amount: d.budgetAmount,
      }));
      const basics: CycleBasics = {
        nameAr: view.cycle.nameAr ?? '',
        nameEn: view.cycle.nameEn ?? '',
        periodStart: view.cycle.periodStart,
        periodEnd: view.cycle.periodEnd,
        deadline: view.cycle.deadline,
        instructionsAr: view.cycle.instructionsAr ?? '',
        instructionsEn: view.cycle.instructionsEn ?? '',
        needsFormId: view.cycle.needsFormId ?? '',
      };
      description = (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Badge tone={CYCLE_TONE[view.status]} dot data-testid="cycle-status">
            {t(`status.${view.status}`)}
          </Badge>
          {t('cycleSettings.subtitle')}
        </span>
      );
      actions = (
        <LaunchCycleButton
          locale={locale}
          cycle={cycle}
          name={title}
          deadline={day(view.cycle.deadline)}
          departments={rows.map((row) => ({
            id: row.departmentId,
            name: row.name,
            head: row.head,
          }))}
          problems={view.problems}
          editHref={cyclesHref(locale, { open: { kind: 'edit', id: cycle.id } })}
          settingsHref={cycleSettingsHref(locale, cycle.id, 'form')}
          structureHref={
            context.navigation.structure ? `/${locale}${PLANNING_PATHS.structure}` : null
          }
          launchedHref={`${cycleHref(locale, cycle.id)}?launched=1`}
          texts={texts}
          errors={errors}
        />
      );
      let section: ReactNode;
      switch (tab) {
        case 'departments':
          section = (
            <CycleDepartmentsForm
              locale={locale}
              cycle={cycle}
              currency={view.cycle.currency}
              unitColumn={unitsLabel(
                view.levels,
                ordinals,
                locale,
                t('setup.budget.columns.department'),
              )}
              rows={rows}
              units={pickerUnits(locale, view.setup.units, view.levels, headVia)}
              branches={view.setup.branches.map((b) => ({
                id: b.id,
                name: localName(locale, b.name),
                active: b.active,
              }))}
              scope={view.cycle.scope}
              canPickHeads={context.navigation.structure}
              texts={texts}
              errors={errors}
            />
          );
          break;
        case 'instructions':
          section = (
            <CycleInstructionsForm
              locale={locale}
              cycle={cycle}
              basics={basics}
              nameLanguage={view.nameLanguage}
              texts={texts}
              errors={errors}
            />
          );
          break;
        case 'reminders':
          section = (
            <CycleRemindersForm
              locale={locale}
              cycle={cycle}
              initial={view.cycle.reminderDays}
              texts={texts}
              errors={errors}
            />
          );
          break;
        case 'form':
          section = (
            <CycleNeedsFormForm
              locale={locale}
              cycle={cycle}
              basics={basics}
              needsForms={view.setup.needsForms.map((f) => ({
                id: f.id,
                name: localName(locale, f.name),
                active: f.active,
              }))}
              needsFormsLabel={shell('needsForms')}
              texts={texts}
              errors={errors}
            />
          );
          break;
      }
      content = (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6">
          <TabNav
            variant="side"
            label={t('cycleSettings.tabsLabel')}
            current={tab}
            items={SETTINGS_TABS.map((key) => ({
              key,
              href: cycleSettingsHref(locale, cycle.id, key),
              label: t(`cycleSettings.tabs.${key}`),
              icon: TAB_ICON[key],
            }))}
            className="xl:sticky xl:top-24"
            data-testid="cycle-settings-tabs"
          />
          {section}
        </div>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} description={description} actions={actions} />
      {content}
    </SuiteShell>
  );
}
