'use client';
import { savePlanningSettingsAction } from '@jadarat/tms/actions/planning';
import { PLAN_LIMITS } from '@jadarat/tms/planning-rules';
import { Alert, Card, SaveBar, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { parseReminderDays } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion } from '../latest-version';
import { LeaveGuard } from '../settings/leave-guard';
import { ReminderDaysEditor } from './reminder-days-editor';
import { useFocusInvalid } from './use-focus-invalid';
import { usePlanningTexts } from './use-planning-texts';

export interface PlanningSettingsFormProps {
  readonly locale: 'ar' | 'en';
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly initialDays: readonly number[];
  /** «Finance confirms the plan» (WP-LD-03; off by default) and its texts (namespace planApproval.settings). */
  readonly initialFinance: boolean;
  readonly financeTexts: {
    readonly title: string;
    readonly intro: string;
    readonly label: string;
    readonly hint: string;
    readonly on: string;
    readonly off: string;
  };
}

const SETTINGS_FORM = 'planning-settings';

/**
 * Planning settings (business flow A3; redesign package 4): the default reminders as chips; the floating
 * save bar appears once something changed (Discard / Save settings) and a toast confirms the save. The
 * default approval chain is no longer set here (EP-PLN §13; PO, 12 Nov 2026): approval is by role and the
 * same for every cycle. One section, so no tabs: the settings page shape of WP-UX-01 e — leaving with
 * unsaved changes asks first, and a refused save moves the focus to the field with the message.
 */
export function PlanningSettingsForm(props: PlanningSettingsFormProps) {
  const { t, formMessage } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(props.initialDays.map(String));
  const [days, setDays] = useState<string[]>(saved);
  const [savedFinance, setSavedFinance] = useState(props.initialFinance);
  const [finance, setFinance] = useState(props.initialFinance);
  const [daysError, setDaysError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = days.join(',') !== saved.join(',') || finance !== savedFinance;
  const { form, focusInvalid } = useFocusInvalid(pending);

  // Said to the page: it does not reload itself over unsaved entries (RefreshOnReturn, WP-FIX-03).
  useEffect(() => {
    if (dirty) document.body.dataset.unsaved = 'true';
    else delete document.body.dataset.unsaved;
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseReminderDays(days);
    setDaysError(parsed.ok ? undefined : t(parsed.key));
    if (!parsed.ok) {
      focusInvalid();
      return;
    }
    startTransition(async () => {
      const result = await savePlanningSettingsAction({
        reminderDays: parsed.days,
        financeConfirms: finance,
      });
      if (result.ok) {
        setSaved(days);
        setSavedFinance(finance);
        toast.success(t('settings.saved'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(formMessage(result.error));
      focusInvalid();
    });
  }

  return (
    <form
      ref={form}
      id={SETTINGS_FORM}
      onSubmit={onSubmit}
      onReset={(event) => {
        event.preventDefault();
        setDays(saved);
        setFinance(savedFinance);
        setDaysError(undefined);
        setNotice(null);
      }}
      noValidate
      className="flex flex-col gap-4"
      data-testid="planning-settings"
    >
      {notice ? (
        <Alert tone="danger">
          {notice}
          <LoadLatestVersion message={notice} />
        </Alert>
      ) : null}
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
      <Card title={props.financeTexts.title} description={props.financeTexts.intro}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span id="finance-confirms-label" className="font-semibold">
              {props.financeTexts.label}
            </span>
            <span id="finance-confirms-hint" className="text-sm text-text-muted">
              {props.financeTexts.hint}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={finance}
            aria-labelledby="finance-confirms-label"
            aria-describedby="finance-confirms-hint"
            disabled={pending}
            onClick={() => {
              setFinance((value) => !value);
            }}
            className={cn(
              'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              finance ? 'bg-primary' : 'bg-border-strong',
            )}
            data-testid="finance-confirms"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block size-6 rounded-full bg-surface shadow-1 transition-transform',
                finance ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
              )}
            />
            <span className="sr-only">
              {finance ? props.financeTexts.on : props.financeTexts.off}
            </span>
          </button>
        </div>
      </Card>
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
      <LeaveGuard
        active={dirty && !pending}
        texts={{
          leaveTitle: t('leaveTitle'),
          leaveText: t('leaveText'),
          leaveStay: t('leaveStay'),
          leaveGo: t('leaveGo'),
          close: t('setup.close'),
        }}
      />
    </form>
  );
}
