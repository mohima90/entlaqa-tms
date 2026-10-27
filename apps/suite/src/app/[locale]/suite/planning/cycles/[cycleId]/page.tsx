import { toClientError } from '@jadarat/platform-core';
import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import { formatDisplayDate } from '@jadarat/platform-i18n/dates';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CycleView } from '@jadarat/tms';
import { earliestExtension } from '@jadarat/tms/planning-rules';
import {
  Alert,
  Badge,
  Card,
  Icon,
  type IconName,
  ProgressBar,
  type StepListItem,
  buttonClasses,
  cn,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FlagToast } from '../../../../../../components/flag-toast';
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
import { PlanningHeader } from '../../../../../../components/planning/planning-header';
import { ProgressTable } from '../../../../../../components/planning/progress-table';
import { SetupStepNav } from '../../../../../../components/planning/setup-step-nav';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { toDrafts } from '../../../../../../lib/planning-chain';
import { cycleDepartmentHref } from '../../../../../../lib/needs-view';
import { dayFormatter, formatAmount } from '../../../../../../lib/planning-format';
import {
  planCycleQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../../lib/planning-queries';
import {
  CYCLE_TONE,
  FORM_TONE,
  OPTIONAL_STEPS,
  PLANNING_PATHS,
  PROBLEM_STEP,
  SETUP_STEPS,
  STATUS_FILTERS,
  type SetupStep,
  cycleHref,
  daysLeft,
  localName,
  previousStep,
  setupStep,
  statusCounts,
  stepMarks,
  sumAmounts,
} from '../../../../../../lib/planning-view';
import {
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../../lib/structure-view';
import { type SuiteContext, getSuiteContext } from '../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One planning cycle (EP-PLN screens 4 and 5; redesign package 4). A draft opened by the L&D Manager is the
 * set-up — a side step list (Basics, Scope, Budget, Approval chain, Reminders, Review & launch), each step
 * saved on its own with «Save and continue»; the last step lists what blocks the launch, each with the step
 * that fixes it, a summary of every step and the launch. Otherwise the cycle's overview: its progress with
 * status chips that filter the units, the deadline extension while open, the approval chain.
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
  let description: ReactNode;
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
      const day = dayFormatter(locale, context.regional.dateDisplay);
      title = localName(locale, { ar: view.cycle.nameAr, en: view.cycle.nameEn });
      if (view.editable) {
        const texts = planningTexts(locale);
        const errors = await planningErrorTexts(locale);
        description = (
          <Badge tone={CYCLE_TONE[view.status]} dot data-testid="cycle-status">
            {t(`status.${view.status}`)}
          </Badge>
        );
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
        const left = daysLeft(view.today, view.cycle.deadline);
        description = (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
            <Badge tone={CYCLE_TONE[view.status]} dot data-testid="cycle-status">
              {t(`status.${view.status}`)}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" className="size-4" />
              {t('cycle.deadline')}:{' '}
              <b className="text-text" data-testid="cycle-deadline">
                {day(view.cycle.deadline)}
              </b>
            </span>
            {view.status === 'open' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-2.5 py-0.5 text-[13.5px] font-semibold text-primary-text">
                <Icon name="clock" className="size-3.5" />
                {t('list.daysLeft', { count: Math.max(left, 0) })}
              </span>
            ) : null}
            {view.cycle.launchedAt ? (
              <span>
                {t('cycle.launchedOn', {
                  date: formatDisplayDate(view.cycle.launchedAt, {
                    locale,
                    display: context.regional.dateDisplay,
                    timeZone: context.regional.timeZone,
                    style: 'date',
                  }),
                })}
              </span>
            ) : null}
          </div>
        );
        if (view.canExtend) {
          actions = (
            <ExtendDeadlineButton
              locale={locale}
              cycle={{ id: view.cycle.id, version: view.cycle.version }}
              texts={planningTexts(locale)}
              errors={await planningErrorTexts(locale)}
              deadline={view.cycle.deadline}
              earliest={earliestExtension(view.cycle.deadline, view.today)}
              periodEnd={view.cycle.periodEnd}
              hint={t('cycle.extendHint', { end: day(view.cycle.periodEnd) })}
              display={context.regional.dateDisplay}
            />
          );
        }
        content = await Overview({
          locale,
          view,
          launched: query.launched === '1',
          display: context.regional.dateDisplay,
        });
      }
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} description={description} actions={actions} />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}

/** The step's name for the step list and the review (the last one has its own key). */
async function stepNames(locale: AppLocale): Promise<Record<SetupStep, string>> {
  const t = await getTranslations({ locale, namespace: 'planning.setup.steps' });
  return Object.fromEntries(SETUP_STEPS.map((step) => [step, t(step)])) as Record<
    SetupStep,
    string
  >;
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
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const names = await stepNames(locale);
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
  const approverNames = Object.fromEntries(
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
          display={context.regional.dateDisplay}
          needsFormsLabel={shell('needsForms')}
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
          names={approverNames}
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
    case 'review':
      form = await Review({ locale, view, context, texts, errors, names });
      break;
  }

  // The step list: ✓ / ! from today's launch problems; «optional» under Budget and Reminders.
  const marks = stepMarks(view.problems);
  const plain = (text: string) => text.replace(/[()]/g, '');
  const items: StepListItem[] = SETUP_STEPS.map((key) => ({
    key,
    label: names[key],
    href: cycleHref(locale, cycle.id, key),
    state: marks[key],
    note:
      marks[key] === 'problem'
        ? plain(t('setup.stepProblem'))
        : OPTIONAL_STEPS.includes(key)
          ? plain(t('setup.optional'))
          : undefined,
    srNote:
      marks[key] === 'problem'
        ? t('setup.stepProblem')
        : marks[key] === 'done'
          ? t('setup.stepDone')
          : undefined,
    icon: key === 'review' ? 'flag' : undefined,
    testId: `setup-step-${key}`,
  }));

  return (
    <>
      <Alert tone="info">{t('setup.draftNote')}</Alert>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[252px_minmax(0,1fr)] lg:gap-7">
        <SetupStepNav
          label={t('setup.stepsLabel')}
          items={items}
          current={step}
          short={t('setup.stepShort', {
            current: SETUP_STEPS.indexOf(step) + 1,
            total: SETUP_STEPS.length,
            name: names[step],
          })}
          texts={{
            leaveTitle: t('setup.leaveTitle', { step: names[step] }),
            leaveBody: t('setup.leaveBody'),
            keepEditing: common('keepEditing'),
            discard: common('discardChanges'),
            close: t('setup.close'),
          }}
        />
        <div className="flex min-w-0 flex-col gap-4">{form}</div>
      </div>
    </>
  );
}

/** A summary card of a set-up step on Review & launch, with «Edit» to its step. */
function ReviewCard({
  title,
  icon,
  editHref,
  editLabel,
  edit,
  warn,
  children,
  testId,
}: {
  title: string;
  icon: IconName;
  editHref: string;
  editLabel: string;
  edit: string;
  warn: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-[20px] border bg-surface px-5 py-4.5',
        warn ? 'border-warning/50 border-s-4 border-s-warning' : 'border-border',
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <h3 className="m-0 flex flex-1 items-center gap-2 text-base font-bold">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-[10px] bg-primary-subtle text-primary-text"
          >
            <Icon name={icon} className="size-4" />
          </span>
          {title}
        </h3>
        <a
          href={editHref}
          aria-label={editLabel}
          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
        >
          <Icon name="pencil" className="size-3.5" />
          {edit}
        </a>
      </div>
      {children}
    </section>
  );
}

/**
 * Step 6 — Review & launch (redesign package 4): the existing launch checks (`view.problems`) first, each
 * with «Go to {step}»; then a summary of every step with Edit; then the launch, disabled with the reason
 * until nothing blocks it. The server checks readiness again on launch.
 */
async function Review({
  locale,
  view,
  context,
  texts,
  errors,
  names,
}: {
  locale: AppLocale;
  view: CycleView;
  context: SuiteContext;
  texts: Record<string, string>;
  errors: Record<string, string>;
  names: Record<SetupStep, string>;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const forms = await getTranslations({ locale, namespace: 'needsForms' });
  const day = dayFormatter(locale, context.regional.dateDisplay);
  const cycle = { id: view.cycle.id, version: view.cycle.version };
  const ready = view.problems.length === 0;
  const flagged = new Set(view.problems.map((problem) => PROBLEM_STEP[problem]));
  const unitNames = new Map(
    (view.setup?.units ?? []).map((u) => [u.id, localName(locale, u.name)]),
  );
  const branchNames = new Map(
    (view.setup?.branches ?? []).map((b) => [b.id, localName(locale, b.name)]),
  );
  const picked = [
    ...view.cycle.scope.branchIds.map((id) => branchNames.get(id)),
    ...view.cycle.scope.departmentIds.map((id) => unitNames.get(id)),
  ].filter((name): name is string => Boolean(name));
  const needsForm = (view.setup?.needsForms ?? []).find((f) => f.id === view.cycle.needsFormId);
  const total = sumAmounts(view.departments.map((d) => d.budgetAmount));
  const totalText = formatAmount(locale, total, view.cycle.currency);
  const card = (step: Exclude<SetupStep, 'review'>, icon: IconName, body: ReactNode) => (
    <ReviewCard
      title={names[step]}
      icon={icon}
      editHref={cycleHref(locale, cycle.id, step)}
      editLabel={t('setup.editStep', { step: names[step] })}
      edit={forms('edit')}
      warn={flagged.has(step)}
      testId={`review-${step}`}
    >
      {body}
    </ReviewCard>
  );
  const facts = (rows: readonly (readonly [string, ReactNode])[]) => (
    <dl className="m-0 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[13px] text-text-muted">{label}</dt>
          <dd className="m-0 font-semibold [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      {ready ? (
        <div
          role="status"
          className="flex items-start gap-4 rounded-[22px] border border-success/40 bg-success-subtle px-5.5 py-5"
          data-testid="cycle-ready"
        >
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-success"
          >
            <Icon name="success" className="size-6" />
          </span>
          <div>
            <h2 className="m-0 text-[19px] font-bold text-success">{t('setup.launch.ready')}</h2>
            <p className="m-0 mt-0.5 text-text-muted">
              {t('setup.launch.confirmBody', {
                count: view.departments.length,
                deadline: day(view.cycle.deadline),
              })}
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex items-start gap-4 rounded-[22px] border border-warning/40 bg-warning-subtle px-4 py-5 md:px-5.5"
          data-testid="cycle-problems"
        >
          <span
            aria-hidden="true"
            className="hidden size-12 shrink-0 place-items-center rounded-2xl bg-surface text-warning sm:grid"
          >
            <Icon name="warning" className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 mb-2.5 mt-0.5 text-[19px] font-bold">
              {t('setup.launch.notReady')}
            </h2>
            <p className="m-0 mb-3 text-sm text-text-muted">{t('setup.reviewIntro')}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.problems.map((problem) => {
                const target = PROBLEM_STEP[problem];
                const href = target
                  ? cycleHref(locale, cycle.id, target)
                  : `/${locale}${PLANNING_PATHS.cycles}`;
                const to = target ? names[target] : t('breadcrumb.cycles');
                return (
                  <li
                    key={problem}
                    className="flex flex-wrap items-center gap-3 rounded-[14px] border border-warning/40 bg-surface py-2.5 pe-2.5 ps-3.5"
                    data-testid={`cycle-problem-${problem}`}
                  >
                    <Icon name="info" className="size-4 text-warning" />
                    <span className="min-w-0 flex-1">{t(`setup.launch.problems.${problem}`)}</span>
                    <a
                      href={href}
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      data-testid={`cycle-problem-go-${problem}`}
                    >
                      {t('setup.goToStep', { step: to })}
                      <Icon name="arrow-end" className="size-3.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-2">
        {card(
          'basics',
          'calendar',
          facts([
            [
              t('setup.basics.nameEn'),
              <bdi key="en" lang="en" dir="ltr">
                {view.cycle.nameEn}
              </bdi>,
            ],
            [
              t('setup.basics.nameAr'),
              <bdi key="ar" lang="ar" dir="rtl">
                {view.cycle.nameAr}
              </bdi>,
            ],
            [t('cycle.period'), `${day(view.cycle.periodStart)} – ${day(view.cycle.periodEnd)}`],
            [
              t('cycle.deadline'),
              <span
                key="deadline"
                className={view.problems.includes('deadline_past') ? 'text-warning' : undefined}
              >
                {day(view.cycle.deadline)}
              </span>,
            ],
            [
              t('setup.basics.needsForm'),
              needsForm ? localName(locale, needsForm.name) : t('setup.basics.needsFormNone'),
            ],
            [t('cycle.currency'), view.cycle.currency],
          ]),
        )}
        {card(
          'scope',
          'structure',
          <>
            <p className="m-0 font-bold">
              {t('setup.scope.formsTitle', { count: view.departments.length })}
            </p>
            {picked.length > 0 ? (
              <p className="m-0 text-sm text-text-muted">{picked.join(' · ')}</p>
            ) : null}
            {view.withoutHead > 0 ? (
              <Alert tone="warning">
                {t('setup.scope.noHeadWarning', { count: view.withoutHead })}
              </Alert>
            ) : null}
          </>,
        )}
        {card(
          'budget',
          'billing',
          <>
            <p className="m-0 text-2xl font-bold tabular-nums">{totalText}</p>
            <p className="m-0 text-sm text-text-muted">
              {t('setup.budget.total', { amount: totalText })}
            </p>
          </>,
        )}
        {card(
          'approvals',
          'people',
          <ol className="m-0 grid gap-1 ps-5">
            {view.steps.map((s, index) => {
              const name = localName(locale, { ar: s.nameAr, en: s.nameEn });
              return (
                <li key={`${String(index)}-${s.kind}`}>
                  {s.kind === 'department_heads' ? (
                    t('cycle.stepHeads', { step: name })
                  ) : s.approverName ? (
                    t('cycle.stepPerson', { step: name, name: localName(locale, s.approverName) })
                  ) : (
                    <span className="font-semibold text-warning">
                      {t('cycle.stepUnnamed', { step: name })}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>,
        )}
        {card(
          'reminders',
          'bell',
          <>
            {view.cycle.reminderDays.length > 0 ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {view.cycle.reminderDays.map((days) => (
                  <li
                    key={days}
                    className="inline-flex min-h-9 items-center rounded-full border border-primary/30 bg-primary-subtle px-3.5 font-semibold text-primary-text"
                  >
                    {t('setup.reminders.chip', { days })}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-text-muted">{t('setup.reminders.none')}</p>
            )}
            <p className="m-0 text-sm text-text-muted">{t('setup.reminders.notificationsNote')}</p>
          </>,
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-[22px] border border-border bg-surface px-5.5 py-4.5 shadow-2">
        <p className="m-0 min-w-55 flex-1 text-text-muted" id={ready ? undefined : 'launch-why'}>
          {ready ? t('setup.launchReady') : t('setup.launchBlocked')}
        </p>
        <LaunchCycleButton
          locale={locale}
          cycle={cycle}
          texts={texts}
          errors={errors}
          disabled={!ready}
          describedBy={ready ? undefined : 'launch-why'}
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
    </>
  );
}

async function Overview({
  locale,
  view,
  launched,
  display,
}: {
  locale: AppLocale;
  view: CycleView;
  launched: boolean;
  display: DateDisplay;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const day = dayFormatter(locale, display);
  const format = await getFormatter({ locale });
  const number = (n: number) => format.number(n, 'integer');
  const counts = statusCounts(view.departments.map((d) => d.status));
  // The organization's own level names (guided-test feedback #3).
  const ordinals = view.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  const instructions =
    locale === 'ar'
      ? (view.cycle.instructionsAr ?? view.cycle.instructionsEn)
      : (view.cycle.instructionsEn ?? view.cycle.instructionsAr);
  const submitted = t('list.submitted', {
    submitted: number(counts.submitted),
    count: number(counts.all),
  });

  return (
    <>
      {launched ? <FlagToast message={t('setup.launch.launched')} param="launched" /> : null}
      {view.status === 'closed' ? <Alert tone="info">{t('cycle.closedNote')}</Alert> : null}
      <Card
        title={t('cycle.progressTitle')}
        description={`${t('cycle.progressIntroNeeds')} ${t('cycle.remindSoon')}`}
        data-testid="progress-card"
      >
        {/* TODO(BACKLOG T-M3-04 follow-up): «Send reminder» per department with in-app notifications (FR-NTF-01). */}
        <div className="flex flex-col gap-2.5" data-testid="progress-summary">
          <span className="text-[34px] font-bold leading-[1.1] tabular-nums">
            {number(counts.submitted)}
            <small className="ms-1.5 text-[15px] font-medium text-text-muted">
              / {number(counts.all)}
            </small>
          </span>
          <ProgressBar value={counts.submitted} max={counts.all} label={submitted} />
          <span className="text-text-muted">{submitted}</span>
        </div>
        <div className="mt-5">
          <ProgressTable
            rows={view.departments.map((row) => ({
              id: row.departmentId,
              name: unitNameWithLevel(
                localName(locale, row.name),
                row.levelOrdinal,
                view.levels,
                locale,
                withLevels,
              ),
              head: row.head
                ? row.head.via
                  ? t('cycle.headVia', {
                      name: localName(locale, row.head.name),
                      unit: localName(locale, row.head.via),
                    })
                  : localName(locale, row.head.name)
                : null,
              envelope:
                row.budgetAmount === null
                  ? t('cycle.noEnvelope')
                  : formatAmount(locale, row.budgetAmount, view.cycle.currency),
              status: row.status,
              statusLabel: t(`cycle.formStatus.${row.status}`),
              tone: FORM_TONE[row.status],
              needs: t('cycle.needsCell', { needs: row.needs.count, seats: row.needs.seats }),
              note:
                row.deadline !== view.cycle.deadline
                  ? t('cycle.extendedTo', { date: day(row.deadline) })
                  : null,
              href:
                view.cycle.status === 'draft'
                  ? null
                  : cycleDepartmentHref(locale, view.cycle.id, row.departmentId),
              viewLabel: t('cycle.viewNeeds', { name: localName(locale, row.name) }),
            }))}
            counts={
              Object.fromEntries(STATUS_FILTERS.map((key) => [key, number(counts[key])])) as Record<
                (typeof STATUS_FILTERS)[number],
                string
              >
            }
            texts={{
              filterLabel: t('cycle.filterLabel'),
              caption: t('cycle.tableCaption'),
              noHead: t('cycle.noHead'),
              envelope: t('cycle.columns.envelope'),
              chips: {
                all: t('list.tabs.all'),
                not_started: t('cycle.formStatus.not_started'),
                draft: t('cycle.formStatus.draft'),
                submitted: t('cycle.formStatus.submitted'),
                returned: t('cycle.formStatus.returned'),
                late: t('cycle.formStatus.late'),
              },
              columns: {
                department: unitsLabel(
                  view.levels,
                  ordinals,
                  locale,
                  t('cycle.columns.department'),
                ),
                head: t('cycle.columns.head'),
                envelope: t('cycle.columns.envelope'),
                needs: t('cycle.columns.needs'),
                status: t('cycle.columns.status'),
                actions: t('cycle.columns.actions'),
              },
              view: t('cycle.view'),
            }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title={t('cycle.chainTitle')} data-testid="cycle-chain">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {view.steps.map((step, index) => {
              const name = localName(locale, { ar: step.nameAr, en: step.nameEn });
              return (
                <li key={`${String(index)}-${step.kind}`} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-on-brand"
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b>{name}</b>
                    <span className="text-sm text-text-muted">
                      {step.kind === 'department_heads'
                        ? t('setup.approvals.headsHint')
                        : step.approverName
                          ? localName(locale, step.approverName)
                          : t('cycle.stepUnnamed', { step: name })}
                    </span>
                  </span>
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
