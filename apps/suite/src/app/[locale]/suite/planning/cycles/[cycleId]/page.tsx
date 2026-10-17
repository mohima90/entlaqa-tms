import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CycleView } from '@jadarat/tms';
import { earliestExtension } from '@jadarat/tms/planning-rules';
import { Alert, Badge, Card, StatCard, StatGrid, tableClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  DeleteCycleButton,
  ExtendDeadlineButton,
  LaunchCycleButton,
} from '../../../../../../components/planning/cycle-action-buttons';
import { CycleBasicsForm } from '../../../../../../components/planning/cycle-basics-form';
import { CycleBudgetsForm } from '../../../../../../components/planning/cycle-budgets-form';
import {
  CycleRemindersForm,
  CycleStepsForm,
} from '../../../../../../components/planning/cycle-chain-forms';
import { CycleScopeForm } from '../../../../../../components/planning/cycle-scope-form';
import {
  PlanningHeader,
  SetupStepper,
} from '../../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { toDrafts } from '../../../../../../lib/planning-chain';
import { dayFormatter, formatAmount } from '../../../../../../lib/planning-format';
import {
  planCycleQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../../lib/planning-queries';
import {
  CYCLE_TONE,
  FORM_TONE,
  PLANNING_PATHS,
  type SetupStep,
  cycleHref,
  localName,
  previousStep,
  progressCounts,
  setupStep,
} from '../../../../../../lib/planning-view';
import {
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../../lib/structure-view';
import { type SuiteContext, getSuiteContext } from '../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One planning cycle (EP-PLN screens 4 and 5). A draft opened by the L&D Manager is the set-up page — five
 * steps (Basics, Scope, Budget, Approval chain, Reminders), each saved on its own, with «Launch» and
 * «Delete draft»; otherwise the cycle's overview and its progress: one row per department in scope with
 * its form status (Not started · Draft · Submitted · Returned · Late), the deadline extension while open.
 */
export default async function PlanCyclePage({
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
  const path = `${PLANNING_PATHS.cycles}/${cycleId}`;

  let title = t('list.title');
  let content: ReactNode;
  let actions: ReactNode = null;
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
      title = localName(locale, { ar: view.cycle.nameAr, en: view.cycle.nameEn });
      if (view.editable) {
        const texts = planningTexts(locale);
        const errors = await planningErrorTexts(locale);
        actions = (
          <DeleteCycleButton
            locale={locale}
            cycle={{ id: view.cycle.id, version: view.cycle.version }}
            texts={texts}
            errors={errors}
            confirmTitle={t('setup.delete.confirmTitle', { name: title })}
            deletedHref={`/${locale}${PLANNING_PATHS.cycles}?deleted=1`}
          />
        );
        content = await SetUp({
          locale,
          view,
          step: setupStep(query.step),
          texts,
          errors,
          context,
        });
      } else {
        content = await Overview({ locale, view, context, launched: query.launched === '1' });
      }
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} actions={actions} />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}

async function SetUp({
  locale,
  view,
  step,
  texts,
  errors,
  context,
}: {
  locale: AppLocale;
  view: CycleView;
  step: SetupStep;
  texts: Record<string, string>;
  errors: Record<string, string>;
  context: SuiteContext;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const day = dayFormatter(locale, context.regional.dateDisplay);
  const cycle = { id: view.cycle.id, version: view.cycle.version };
  const setup = view.setup;
  const back = previousStep(step);
  const backHref = back ? cycleHref(locale, cycle.id, back) : `/${locale}${PLANNING_PATHS.cycles}`;
  // The organization's own level names (guided-test feedback #3): the column is named after the first
  // level, or «Unit» with each row's level when levels mix.
  const ordinals = view.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  const unitName = (d: CycleView['departments'][number]) =>
    unitNameWithLevel(localName(locale, d.name), d.levelOrdinal, view.levels, locale, withLevels);
  // The unit picker's units: decided once for the list, not again for every unit.
  const setupUnitsWithLevels = showsUnitLevels(
    view.levels,
    (setup?.units ?? []).map((u) => u.levelOrdinal),
  );
  const headName = (head: CycleView['departments'][number]['head']) =>
    head
      ? head.via
        ? t('cycle.headVia', {
            name: localName(locale, head.name),
            unit: localName(locale, head.via),
          })
        : localName(locale, head.name)
      : t('cycle.noHead');
  // Names of the active approvers already in the chain; the picker searches the others (C-M3).
  const names = Object.fromEntries(
    view.steps
      .filter((s) => s.approverPersonId && s.approverActive && s.approverName)
      .map((s) => [
        s.approverPersonId ?? '',
        localName(locale, s.approverName ?? { ar: '', en: null }),
      ]),
  );
  const inactive = Object.fromEntries(
    view.steps
      .filter((s) => s.approverPersonId && !s.approverActive && s.approverName)
      .map((s) => [
        s.approverPersonId ?? '',
        localName(locale, s.approverName ?? { ar: '', en: null }),
      ]),
  );

  let form: ReactNode;
  switch (step) {
    case 'basics':
      form = (
        <CycleBasicsForm
          locale={locale}
          editing={cycle}
          initial={{
            nameAr: view.cycle.nameAr,
            nameEn: view.cycle.nameEn,
            periodStart: view.cycle.periodStart,
            periodEnd: view.cycle.periodEnd,
            deadline: view.cycle.deadline,
            instructionsAr: view.cycle.instructionsAr ?? '',
            instructionsEn: view.cycle.instructionsEn ?? '',
            needsFormId: view.cycle.needsFormId ?? '',
          }}
          needsForms={(setup?.needsForms ?? []).map((f) => ({
            id: f.id,
            name: localName(locale, f.name),
            active: f.active,
          }))}
          currency={view.cycle.currency}
          texts={texts}
          errors={errors}
          cancelHref={`/${locale}${PLANNING_PATHS.cycles}`}
        />
      );
      break;
    case 'scope':
      form = (
        <CycleScopeForm
          locale={locale}
          cycle={cycle}
          units={(setup?.units ?? []).map((u) => ({
            id: u.id,
            parentId: u.parentId,
            branchId: u.branchId,
            name: unitNameWithLevel(
              localName(locale, u.name),
              u.levelOrdinal,
              view.levels,
              locale,
              setupUnitsWithLevels,
            ),
            depth: u.depth,
            active: u.active,
            hasHead: u.hasHead,
          }))}
          branches={(setup?.branches ?? []).map((b) => ({
            id: b.id,
            name: localName(locale, b.name),
            active: b.active,
          }))}
          initial={view.cycle.scope}
          texts={texts}
          errors={errors}
          backHref={backHref}
        />
      );
      break;
    case 'budget':
      form = (
        <CycleBudgetsForm
          locale={locale}
          cycle={cycle}
          currency={view.cycle.currency}
          unitColumn={unitsLabel(
            view.levels,
            ordinals,
            locale,
            t('setup.budget.columns.department'),
          )}
          rows={view.departments.map((d) => ({
            departmentId: d.departmentId,
            name: unitName(d),
            head: headName(d.head),
            amount: d.budgetAmount,
          }))}
          texts={texts}
          errors={errors}
          backHref={backHref}
        />
      );
      break;
    case 'approvals':
      form = (
        <CycleStepsForm
          locale={locale}
          cycle={cycle}
          initial={toDrafts(view.steps)}
          names={names}
          inactive={inactive}
          texts={texts}
          errors={errors}
          backHref={backHref}
        />
      );
      break;
    case 'reminders':
      form = (
        <CycleRemindersForm
          locale={locale}
          cycle={cycle}
          initial={view.cycle.reminderDays}
          texts={texts}
          errors={errors}
          backHref={backHref}
        />
      );
      break;
  }

  const ready = view.problems.length === 0;
  return (
    <>
      <Alert tone="info">{t('setup.draftNote')}</Alert>
      <SetupStepper locale={locale} cycleId={cycle.id} current={step} />
      {form}
      <Card title={t('setup.launch.title')} data-testid="cycle-launch-card">
        <div className="flex flex-col gap-4">
          {ready ? (
            <Alert tone="success" data-testid="cycle-ready">
              {t('setup.launch.ready')}
            </Alert>
          ) : (
            <div data-testid="cycle-problems">
              <p className="m-0 mb-2 font-medium">{t('setup.launch.notReady')}</p>
              <ul className="m-0 flex list-disc flex-col gap-1 ps-6">
                {view.problems.map((problem) => (
                  <li key={problem} data-testid={`cycle-problem-${problem}`}>
                    {t(`setup.launch.problems.${problem}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.withoutHead > 0 ? (
            <Alert tone="warning">
              {t('setup.scope.noHeadWarning', { count: view.withoutHead })}
            </Alert>
          ) : null}
          <div className="flex justify-end">
            <LaunchCycleButton
              locale={locale}
              cycle={cycle}
              texts={texts}
              errors={errors}
              disabled={!ready}
              confirmTitle={t('setup.launch.confirmTitle', {
                name: localName(locale, { ar: view.cycle.nameAr, en: view.cycle.nameEn }),
              })}
              confirmBody={t('setup.launch.confirmBody', {
                count: view.departments.length,
                deadline: day(view.cycle.deadline),
              })}
              launchedHref={`${cycleHref(locale, cycle.id)}?launched=1`}
            />
          </div>
        </div>
      </Card>
    </>
  );
}

async function Overview({
  locale,
  view,
  context,
  launched,
}: {
  locale: AppLocale;
  view: CycleView;
  context: SuiteContext;
  launched: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const format = await getFormatter({ locale });
  const number = (n: number) => format.number(n, 'integer');
  const day = dayFormatter(locale, context.regional.dateDisplay);
  const counts = progressCounts(view.departments.map((d) => d.status));
  // The organization's own level names (guided-test feedback #3).
  const ordinals = view.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  const columnLabel = (key: 'department' | 'head' | 'envelope' | 'status') =>
    key === 'department'
      ? unitsLabel(view.levels, ordinals, locale, t('cycle.columns.department'))
      : t(`cycle.columns.${key}`);
  const texts = view.canExtend ? planningTexts(locale) : null;
  const errors = view.canExtend ? await planningErrorTexts(locale) : null;
  const instructions =
    locale === 'ar'
      ? (view.cycle.instructionsAr ?? view.cycle.instructionsEn)
      : (view.cycle.instructionsEn ?? view.cycle.instructionsAr);

  return (
    <>
      {launched ? (
        <Alert tone="success" data-testid="cycle-launched">
          {t('setup.launch.launched')}
        </Alert>
      ) : null}
      {view.status === 'closed' ? <Alert tone="info">{t('cycle.closedNote')}</Alert> : null}
      <Card data-testid="cycle-summary">
        <dl className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-sm text-text-muted">{t('list.columns.status')}</dt>
            <dd className="m-0 mt-1">
              <Badge tone={CYCLE_TONE[view.status]} data-testid="cycle-status">
                {t(`status.${view.status}`)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-text-muted">{t('cycle.period')}</dt>
            <dd className="m-0 mt-1 font-medium">
              {day(view.cycle.periodStart)} – {day(view.cycle.periodEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-text-muted">{t('cycle.deadline')}</dt>
            <dd className="m-0 mt-1 font-medium" data-testid="cycle-deadline">
              {day(view.cycle.deadline)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-text-muted">{t('cycle.currency')}</dt>
            <dd className="m-0 mt-1 font-medium">{view.cycle.currency}</dd>
          </div>
        </dl>
        {view.cycle.launchedAt ? (
          <p className="m-0 mt-4 text-sm text-text-muted">
            {t('cycle.launchedOn', {
              date: day(view.cycle.launchedAt.toISOString().slice(0, 10)),
            })}
          </p>
        ) : null}
        {view.canExtend && texts && errors ? (
          <div className="mt-4 flex justify-end">
            <ExtendDeadlineButton
              locale={locale}
              cycle={{ id: view.cycle.id, version: view.cycle.version }}
              texts={texts}
              errors={errors}
              deadline={view.cycle.deadline}
              earliest={earliestExtension(view.cycle.deadline, view.today)}
              periodEnd={view.cycle.periodEnd}
              hint={t('cycle.extendHint', { end: day(view.cycle.periodEnd) })}
            />
          </div>
        ) : null}
      </Card>

      <StatGrid label={t('cycle.progressStatsLabel')} data-testid="progress-stats">
        <StatCard
          variant="gradient"
          label={t('cycle.progressStats.departments')}
          value={number(counts.departments)}
          icon="building"
        />
        <StatCard
          variant="gradient"
          label={t('cycle.progressStats.notStarted')}
          value={number(counts.notStarted)}
          icon="inbox"
        />
        <StatCard
          variant="gradient"
          label={t('cycle.progressStats.submitted')}
          value={number(counts.submitted)}
          icon="success"
        />
        <StatCard
          variant="gradient"
          label={t('cycle.progressStats.late')}
          value={number(counts.late)}
          icon="warning"
        />
      </StatGrid>

      <Card
        flush
        title={t('cycle.progressTitle')}
        description={`${t('cycle.progressIntro')} ${t('cycle.remindSoon')}`}
        data-testid="progress-card"
      >
        {/* TODO(BACKLOG T-M3-04 follow-up): «Send reminder» per department with in-app notifications (FR-NTF-01). */}
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table} data-testid="progress-table">
            <caption className="sr-only">{t('cycle.tableCaption')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                {(['department', 'head', 'envelope', 'status'] as const).map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className={tableClasses.head}
                    data-testid={`progress-column-${key}`}
                  >
                    {columnLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.departments.map((row) => (
                <tr key={row.departmentId} className={tableClasses.row} data-testid="progress-row">
                  <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                    {unitNameWithLevel(
                      localName(locale, row.name),
                      row.levelOrdinal,
                      view.levels,
                      locale,
                      withLevels,
                    )}
                  </th>
                  <td className={tableClasses.cell}>
                    {row.head ? (
                      row.head.via ? (
                        t('cycle.headVia', {
                          name: localName(locale, row.head.name),
                          unit: localName(locale, row.head.via),
                        })
                      ) : (
                        localName(locale, row.head.name)
                      )
                    ) : (
                      <Badge tone="warning">{t('cycle.noHead')}</Badge>
                    )}
                  </td>
                  <td className={tableClasses.cell}>
                    {row.budgetAmount === null
                      ? t('cycle.noEnvelope')
                      : formatAmount(locale, row.budgetAmount, view.cycle.currency)}
                  </td>
                  <td className={tableClasses.cell}>
                    <Badge tone={FORM_TONE[row.status]} data-testid="progress-status">
                      {t(`cycle.formStatus.${row.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={t('cycle.chainTitle')} data-testid="cycle-chain">
          <ol className="m-0 flex flex-col gap-2 ps-6">
            {view.steps.map((step, index) => {
              const name = localName(locale, { ar: step.nameAr, en: step.nameEn });
              return (
                <li key={`${String(index)}-${step.kind}`}>
                  {step.kind === 'department_heads'
                    ? t('cycle.stepHeads', { step: name })
                    : step.approverName
                      ? t('cycle.stepPerson', {
                          step: name,
                          name: localName(locale, step.approverName),
                        })
                      : t('cycle.stepUnnamed', { step: name })}
                </li>
              );
            })}
          </ol>
        </Card>
        {instructions ? (
          <Card title={t('cycle.instructions')}>
            <p className="m-0 whitespace-pre-line">{instructions}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
