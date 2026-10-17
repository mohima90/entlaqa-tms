'use client';
import {
  savePlanCycleRemindersAction,
  savePlanCycleStepsAction,
  savePlanningSettingsAction,
} from '@jadarat/tms/actions/planning';
import { PLAN_LIMITS, chainIssues, toFieldErrors } from '@jadarat/tms/planning-rules';
import { Alert, Button, Card, buttonClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { cycleHref, fieldErrorKey } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import {
  type StepDraft,
  fromDrafts,
  parseReminderDays,
  stepNameErrors,
} from '../../lib/planning-chain';
import { ApprovalChainEditor, ReminderDaysEditor } from './chain-editors';
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" data-testid="cycle-steps">
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.approvals.title')} description={t('setup.approvals.intro')}>
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
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('setup.back')}
        </a>
        <Button type="submit" disabled={pending} data-testid="cycle-steps-save">
          {pending ? t('setup.working') : t('setup.saveAndContinue')}
        </Button>
      </div>
    </form>
  );
}

export interface CycleRemindersFormProps extends Common {
  readonly cycle: { readonly id: string; readonly version: number };
  readonly initial: readonly number[];
  readonly backHref: string;
}

/** Step 5 — Reminders of the cycle (business flow B4): days before the deadline. */
export function CycleRemindersForm(props: CycleRemindersFormProps) {
  const { t, message } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<string[]>(props.initial.map(String));
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

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
        toast.success(t('setup.saved'));
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
      className="flex flex-col gap-6"
      data-testid="cycle-reminders"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.reminders.title')} description={t('setup.reminders.intro')}>
        <ReminderDaysEditor
          days={days}
          onChange={(next) => {
            setDays(next);
            setError(undefined);
          }}
          error={error}
          disabled={pending}
          t={t}
          maxReminders={PLAN_LIMITS.maxReminders}
        />
        <p className="m-0 mt-4 text-sm text-text-muted">{t('setup.reminders.notificationsNote')}</p>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('setup.back')}
        </a>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          data-testid="cycle-reminders-save"
        >
          {pending ? t('setup.working') : t('setup.save')}
        </Button>
      </div>
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

/** Planning settings (business flow A3): default reminder days and default approval chain. */
export function PlanningSettingsForm(props: PlanningSettingsFormProps) {
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<string[]>(props.initialDays.map(String));
  const [steps, setSteps] = useState<StepDraft[]>([...props.initialSteps]);
  const [daysError, setDaysError] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

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
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
      data-testid="planning-settings"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('settings.remindersTitle')} description={t('setup.reminders.intro')}>
        <ReminderDaysEditor
          days={days}
          onChange={(next) => {
            setDays(next);
            setDaysError(undefined);
          }}
          error={daysError}
          disabled={pending}
          t={t}
          maxReminders={PLAN_LIMITS.maxReminders}
        />
      </Card>
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
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="planning-settings-save">
          {pending ? t('setup.working') : t('settings.save')}
        </Button>
      </div>
    </form>
  );
}
