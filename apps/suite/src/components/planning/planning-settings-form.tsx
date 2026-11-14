'use client';
import { savePlanningSettingsAction } from '@jadarat/tms/actions/planning';
import { PLAN_LIMITS } from '@jadarat/tms/planning-rules';
import { Alert, Card, SaveBar, toast } from '@jadarat/ui';
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
  const [daysError, setDaysError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = days.join(',') !== saved.join(',');
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
      const result = await savePlanningSettingsAction({ reminderDays: parsed.days });
      if (result.ok) {
        setSaved(days);
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
