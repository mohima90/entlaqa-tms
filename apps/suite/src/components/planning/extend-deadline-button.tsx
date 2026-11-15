'use client';
import type { DateDisplay } from '@jadarat/platform-i18n';
import { extendPlanCycleDeadlineAction } from '@jadarat/tms/actions/planning';
import { Alert, Button, Dialog, Icon, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { dayFormatter } from '../../lib/planning-format';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { usePlanningTexts } from './use-planning-texts';

/**
 * The cycle page's «Extend deadline» button, in a file of its own so that the page does not load the launch
 * and delete popups of the cycles list (cycle-action-buttons.tsx; bundle budget, CI gate 9).
 */

/** What every cycle action popup takes. */
export interface CycleActionCommon {
  readonly locale: 'ar' | 'en';
  readonly cycle: { readonly id: string; readonly version: number };
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

export interface ExtendDeadlineButtonProps extends CycleActionCommon {
  readonly deadline: string;
  /** The earliest new deadline: the day after the current one, never before today (C-7, C-11). */
  readonly earliest: string;
  readonly periodEnd: string;
  /** Formatted on the server: the hint with the period's end. */
  readonly hint: string;
  /** How the organization shows dates («Shown as» under the new deadline). */
  readonly display: DateDisplay;
}

/**
 * «Extend deadline» while the cycle is open (Appendix C; business flow §6 (a)) — also once the deadline has
 * passed (C-7): a later date in the period, today or later.
 */
export function ExtendDeadlineButton(props: ExtendDeadlineButtonProps) {
  const { t, actionMessage, fieldErrors } = usePlanningTexts(
    props.texts,
    props.errors,
    props.locale,
  );
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deadline, setDeadline] = useState(
    props.earliest <= props.periodEnd ? props.earliest : props.deadline,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  function onExtend() {
    setNotice(null);
    if (deadline <= props.deadline) {
      setError(t('setup.fieldErrors.notLater'));
      return;
    }
    if (deadline < props.earliest) {
      setError(t('setup.fieldErrors.inPast'));
      return;
    }
    if (deadline > props.periodEnd) {
      setError(t('setup.fieldErrors.afterPeriod'));
      return;
    }
    startTransition(async () => {
      const result = await extendPlanCycleDeadlineAction({ ...props.cycle, deadline });
      if (result.ok) {
        setOpen(false);
        toast.success(t('cycle.extended'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setError(fieldErrors(result.error).deadline);
      setNotice(actionMessage(result.error));
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="cycle-extend"
      >
        <Icon name="calendar" />
        {t('cycle.extend')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={t('cycle.extendTitle')}
        closeLabel={t('setup.close')}
        size="sm"
        data-testid="cycle-extend-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {t('setup.cancel')}
            </Button>
            <Button onClick={onExtend} disabled={pending} data-testid="cycle-extend-confirm">
              {pending ? t('setup.working') : t('cycle.extendConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {notice ? <Alert tone="danger">{notice}</Alert> : null}
          <TextField
            id="cycle-extend-deadline"
            type="date"
            label={t('cycle.extendLabel')}
            hint={props.hint}
            value={deadline}
            min={props.earliest}
            max={props.periodEnd}
            onChange={(event) => {
              setDeadline(event.target.value);
              setError(undefined);
            }}
            error={error}
            disabled={pending}
          />
          {/^\d{4}-\d{2}-\d{2}$/.test(deadline) && !error ? (
            <p className="m-0 inline-flex w-fit items-center gap-2 rounded-[10px] bg-primary-subtle px-3 py-1.5 text-[13.5px] font-semibold text-primary-text">
              <Icon name="calendar" className="size-3.5" />
              {t('setup.basics.shownAs', {
                date: dayFormatter(props.locale, props.display)(deadline),
              })}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
