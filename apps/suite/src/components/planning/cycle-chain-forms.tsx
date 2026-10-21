'use client';
import {
  savePlanCycleRemindersAction,
  savePlanCycleStepsAction,
  savePlanningSettingsAction,
} from '@jadarat/tms/actions/planning';
import { PLAN_LIMITS, chainIssues, toFieldErrors } from '@jadarat/tms/planning-rules';
import { Alert, Button, Card, Icon, SaveBar, buttonClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import {
  type StepDraft,
  fromDrafts,
  parseReminderDays,
  stepNameErrors,
} from '../../lib/planning-chain';
import { PLANNING_PATHS, cycleHref, fieldErrorKey } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ApprovalChainEditor, ReminderDaysEditor } from './chain-editors';
import { useUnsavedStep } from './setup-step-nav';
import { usePlanningTexts } from './use-planning-texts';

interface Common {
  readonly locale: 'ar' | 'en';
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/** Client checks of a chain (names, BR-PLN-g) as texts by path. */
function chainErrors(
  steps: readonly StepDraft[],
  t: (key: string) => string,
): Record<string, string> {
  const errors = stepNameErrors(steps, t('setup.fieldErrors.required'));
  for (const issue of toFieldErrors(chainIssues(fromDrafts(steps), false))) {
    errors[issue.path] ??= t(fieldErrorKey(issue.code));
  }
  return errors;
}

/** The chain as saved (without the row keys): to tell whether it changed. */
function chainShape(steps: readonly StepDraft[]): string {
  return JSON.stringify(fromDrafts(steps));
}

/** «Defaults come from Planning settings.» with the settings' name as a link (redesign package 4). */
export function DefaultsLink({ locale, t }: { locale: 'ar' | 'en'; t: (key: string) => string }) {
  const text = t('setup.defaultsLink');
  const name = t('settings.title');
  const at = text.indexOf(name);
  const link = <a href={`/${locale}${PLANNING_PATHS.settings}`}>{name}</a>;
  return (
    <p className="m-0 text-sm text-text-muted" data-testid="planning-defaults-link">
      {at === -1 ? (
        <>
          {text} {link}
        </>
      ) : (
        <>
          {text.slice(0, at)}
          {link}
          {text.slice(at + name.length)}
        </>
      )}
    </p>
  );
}

/** Back and «Save and continue» under a set-up step (redesign package 4: the step's own save). */
export function StepFooter({
  backHref,
  backLabel,
  saveLabel,
  pending,
  workingLabel,
  testId,
}: {
  backHref: string;
  backLabel: string;
  saveLabel: string;
  pending: boolean;
  workingLabel: string;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 max-md:[&>*]:flex-1">
      <a href={backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
        {/* «Back» points to the start: the end arrow, turned (it already mirrors in Arabic). */}
        <span className="inline-flex -scale-x-100">
          <Icon name="arrow-end" className="size-4" />
        </span>
        {backLabel}
      </a>
      <Button type="submit" disabled={pending} busy={pending} data-testid={testId}>
        {pending ? workingLabel : saveLabel}
        {pending ? null : <Icon name="arrow-end" className="size-4" />}
      </Button>
    </div>
  );
}

export interface CycleStepsFormProps extends Common {
  readonly cycle: { readonly id: string; readonly version: number };
  readonly initial: readonly StepDraft[];
  /** Names of the active members already named in the chain (C-M3: others are searched). */
  readonly names: Readonly<Record<string, string>>;
  readonly inactive: Readonly<Record<string, string>>;
  readonly backHref: string;
}

/** Step 4 — Approval chain of the cycle (business flow B4): copied from the settings, named people. */
export function CycleStepsForm(props: CycleStepsFormProps) {
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [steps, setSteps] = useState<StepDraft[]>([...props.initial]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedStep(chainShape(steps) !== chainShape(props.initial));

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const found = chainErrors(steps, t);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    startTransition(async () => {
      const result = await savePlanCycleStepsAction({
        id: props.cycle.id,
        version: props.cycle.version,
        steps: fromDrafts(steps),
      });
      if (result.ok) {
        router.push(cycleHref(props.locale, props.cycle.id, 'reminders'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setErrors(fieldErrors(result.error));
      setNotice(message(result.error));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="cycle-steps">
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.approvals.title')} description={t('setup.approvals.intro')}>
        <div className="flex flex-col gap-3.5">
          <ApprovalChainEditor
            locale={props.locale}
            steps={steps}
            onChange={(next) => {
              setSteps(next);
              setErrors({});
            }}
            names={props.names}
            inactive={props.inactive}
            errors={errors}
            disabled={pending}
            t={t}
            maxSteps={PLAN_LIMITS.maxSteps}
          />
          <DefaultsLink locale={props.locale} t={t} />
        </div>
      </Card>
      <StepFooter
        backHref={props.backHref}
        backLabel={t('setup.back')}
        saveLabel={t('setup.saveAndContinue')}
        workingLabel={t('setup.working')}
        pending={pending}
        testId="cycle-steps-save"
      />
    </form>
  );
}

export interface CycleRemindersFormProps extends Common {
  readonly cycle: { readonly id: string; readonly version: number };
  readonly initial: readonly number[];
  readonly backHref: string;
}

/**
 * Step 5 — Reminders of the cycle (business flow B4): days before the deadline as chips. «Save and
 * continue» saves them and goes on to Review & launch (redesign package 4; before, it saved and stayed).
 */
export function CycleRemindersForm(props: CycleRemindersFormProps) {
  const { t, message } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<string[]>(props.initial.map(String));
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedStep(days.join(',') !== props.initial.join(','));

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseReminderDays(days);
    if (!parsed.ok) {
      setError(t(parsed.key));
      return;
    }
    startTransition(async () => {
      const result = await savePlanCycleRemindersAction({
        id: props.cycle.id,
        version: props.cycle.version,
        reminderDays: parsed.days,
      });
      if (result.ok) {
        router.push(cycleHref(props.locale, props.cycle.id, 'review'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(message(result.error));
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      data-testid="cycle-reminders"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.reminders.title')} description={t('setup.reminders.intro')}>
        <div className="flex flex-col gap-4">
          <ReminderDaysEditor
            locale={props.locale}
            days={days}
            onChange={setDays}
            error={error}
            onError={setError}
            disabled={pending}
            t={t}
            maxReminders={PLAN_LIMITS.maxReminders}
          />
          <Alert tone="info">{t('setup.reminders.notificationsNote')}</Alert>
          <DefaultsLink locale={props.locale} t={t} />
        </div>
      </Card>
      <StepFooter
        backHref={props.backHref}
        backLabel={t('setup.back')}
        saveLabel={t('setup.saveAndContinue')}
        workingLabel={t('setup.working')}
        pending={pending}
        testId="cycle-reminders-save"
      />
    </form>
  );
}

export interface PlanningSettingsFormProps extends Common {
  readonly initialDays: readonly number[];
  readonly initialSteps: readonly StepDraft[];
  /** Names of the active members already named in the chain (C-M3: others are searched). */
  readonly names: Readonly<Record<string, string>>;
  readonly inactive: Readonly<Record<string, string>>;
}

const SETTINGS_FORM = 'planning-settings';

/**
 * Planning settings (business flow A3; redesign package 4): the default approval chain as a numbered
 * timeline and the default reminders as chips, side by side; the floating save bar appears once something
 * changed (Discard / Save settings) and a toast confirms the save.
 */
export function PlanningSettingsForm(props: PlanningSettingsFormProps) {
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState({
    days: props.initialDays.map(String),
    steps: [...props.initialSteps],
  });
  const [days, setDays] = useState<string[]>(saved.days);
  const [steps, setSteps] = useState<StepDraft[]>(saved.steps);
  const [daysError, setDaysError] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const dirty =
    days.join(',') !== saved.days.join(',') || chainShape(steps) !== chainShape(saved.steps);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseReminderDays(days);
    const found = chainErrors(steps, t);
    setDaysError(parsed.ok ? undefined : t(parsed.key));
    setErrors(found);
    if (!parsed.ok || Object.keys(found).length > 0) return;
    startTransition(async () => {
      const result = await savePlanningSettingsAction({
        reminderDays: parsed.days,
        steps: fromDrafts(steps),
      });
      if (result.ok) {
        setSaved({ days, steps });
        toast.success(t('settings.saved'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setErrors(fieldErrors(result.error));
      setNotice(message(result.error));
    });
  }

  return (
    <form
      id={SETTINGS_FORM}
      onSubmit={onSubmit}
      onReset={(event) => {
        event.preventDefault();
        setDays(saved.days);
        setSteps(saved.steps);
        setErrors({});
        setDaysError(undefined);
        setNotice(null);
      }}
      noValidate
      className="flex flex-col gap-4"
      data-testid="planning-settings"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card title={t('settings.chainTitle')} description={t('setup.approvals.intro')}>
          <ApprovalChainEditor
            locale={props.locale}
            steps={steps}
            onChange={(next) => {
              setSteps(next);
              setErrors({});
            }}
            names={props.names}
            inactive={props.inactive}
            errors={errors}
            disabled={pending}
            t={t}
            maxSteps={PLAN_LIMITS.maxSteps}
          />
        </Card>
        <Card title={t('settings.remindersTitle')} description={t('setup.reminders.intro')}>
          <div className="flex flex-col gap-4">
            <ReminderDaysEditor
              locale={props.locale}
              days={days}
              onChange={setDays}
              error={daysError}
              onError={setDaysError}
              disabled={pending}
              t={t}
              maxReminders={PLAN_LIMITS.maxReminders}
            />
            <Alert tone="info">{t('setup.reminders.notificationsNote')}</Alert>
          </div>
        </Card>
      </div>
      {dirty || pending ? (
        <SaveBar
          state={pending ? 'saving' : 'unsaved'}
          form={SETTINGS_FORM}
          texts={{
            unsaved: t('unsavedChanges'),
            saving: t('setup.working'),
            saved: '',
            save: t('settings.save'),
            cancel: t('discardChanges'),
          }}
        />
      ) : null}
    </form>
  );
}
