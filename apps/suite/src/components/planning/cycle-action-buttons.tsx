'use client';
import {
  deletePlanCycleAction,
  extendPlanCycleDeadlineAction,
  launchPlanCycleAction,
} from '@jadarat/tms/actions/planning';
import type { DateDisplay } from '@jadarat/platform-i18n';
import { Alert, Button, Dialog, Icon, TextField, toast } from '@jadarat/ui';
import { dayFormatter } from '../../lib/planning-format';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { usePlanningTexts } from './use-planning-texts';

interface Common {
  readonly locale: 'ar' | 'en';
  readonly cycle: { readonly id: string; readonly version: number };
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

export interface LaunchCycleButtonProps extends Common {
  /** Formatted on the server: «Launch {name}?» and the body with the plural count and the deadline. */
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly disabled: boolean;
  /** Where to go once launched (the cycle's progress with its confirmation). */
  readonly launchedHref: string;
  /** The id of the text that says why the launch is not possible yet (Review & launch). */
  readonly describedBy?: string | undefined;
}

/** «Launch cycle» (business flow B5): asks first; the server checks readiness again. */
export function LaunchCycleButton(props: LaunchCycleButtonProps) {
  const { t, message } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function onLaunch() {
    setNotice(null);
    startTransition(async () => {
      const result = await launchPlanCycleAction(props.cycle);
      if (result.ok) {
        setOpen(false);
        router.push(props.launchedHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(message(result.error));
    });
  }

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        size="lg"
        className="max-md:w-full"
        data-testid="cycle-launch"
      >
        <Icon name="flag" />
        {t('setup.launch.action')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={props.confirmTitle}
        description={props.confirmBody}
        closeLabel={t('setup.close')}
        size="sm"
        data-testid="cycle-launch-dialog"
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
            <Button onClick={onLaunch} disabled={pending} data-testid="cycle-launch-confirm">
              {pending ? t('setup.working') : t('setup.launch.confirm')}
            </Button>
          </>
        }
      >
        {notice ? (
          <Alert tone="danger" data-testid="cycle-launch-error">
            {notice}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}

export interface DeleteCycleButtonProps extends Common {
  readonly confirmTitle: string;
  readonly deletedHref: string;
}

/** «Delete draft»: only a draft is deleted (the database refuses a launched cycle). */
export function DeleteCycleButton(props: DeleteCycleButtonProps) {
  const { t, message } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function onDelete() {
    setNotice(null);
    startTransition(async () => {
      const result = await deletePlanCycleAction(props.cycle);
      if (result.ok) {
        setOpen(false);
        router.push(props.deletedHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(message(result.error));
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        className="text-danger hover:bg-danger-subtle"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="cycle-delete"
      >
        <Icon name="trash" />
        {t('setup.delete.action')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={props.confirmTitle}
        description={t('setup.delete.confirmBody')}
        closeLabel={t('setup.close')}
        size="sm"
        data-testid="cycle-delete-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {t('setup.delete.keep')}
            </Button>
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={pending}
              data-testid="cycle-delete-confirm"
            >
              {pending ? t('setup.working') : t('setup.delete.confirm')}
            </Button>
          </>
        }
      >
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
      </Dialog>
    </>
  );
}

export interface ExtendDeadlineButtonProps extends Common {
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
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
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
      setNotice(message(result.error));
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
