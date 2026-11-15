'use client';
import { openConsolidationAction } from '@jadarat/tms/actions/consolidation';
import { Alert, Button, Dialog, EmptyState, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ErrorTexts } from '../auth/error-text';
import { usePlanTexts } from './use-plan-texts';

export interface PlanNotOpenProps {
  readonly locale: 'ar' | 'en';
  readonly cycleId: string;
  /** The readiness of the query (`view.readiness`), the deadline as shown, and whether the viewer may open it. */
  readonly readiness:
    | { readonly ready: true; readonly closeEarly: boolean }
    | {
        readonly ready: false;
        readonly reason:
          'not_launched' | 'already_open' | 'waiting_for_departments' | 'no_departments';
        readonly waiting: number;
      };
  readonly deadline: string;
  readonly canOpen: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * The Plan tab before the plan exists (design README «Empty», Q1 = A): the plan is built when the needs close —
 * after the deadline, or with «Close needs now» once every department has submitted. The L&D Manager who may
 * build it gets the button; closing early asks first (the heads can no longer change their needs).
 */
export function PlanNotOpen(props: PlanNotOpenProps) {
  const { t, actionMessage, sessionRefused } = usePlanTexts(
    props.texts,
    props.errors,
    props.locale,
  );
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { readiness } = props;

  function open() {
    setNotice(null);
    startTransition(async () => {
      const result = await openConsolidationAction({ cycleId: props.cycleId });
      if (result.ok) {
        setConfirming(false);
        toast.success(
          t('notOpen.opened', { lines: result.value.lines, needs: result.value.needs }),
        );
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(actionMessage(result.error));
    });
  }

  const body = readiness.ready
    ? readiness.closeEarly
      ? t('notOpen.allSubmitted', { date: props.deadline })
      : t('notOpen.closed')
    : readiness.reason === 'waiting_for_departments'
      ? t('notOpen.waiting', { date: props.deadline, count: readiness.waiting })
      : t('notOpen.notLaunched');

  return (
    <div
      className="rounded-xl border border-border bg-surface shadow-2"
      data-testid="plan-not-open"
    >
      {notice && !confirming ? (
        <Alert tone="danger" className="m-5 mb-0">
          {notice}
        </Alert>
      ) : null}
      <EmptyState
        icon="plan"
        title={t('notOpen.title', { date: props.deadline })}
        description={body}
        action={
          readiness.ready && props.canOpen ? (
            <Button
              busy={pending && !readiness.closeEarly}
              disabled={pending}
              onClick={() => {
                if (readiness.closeEarly) setConfirming(true);
                else open();
              }}
              data-testid="plan-open"
            >
              {readiness.closeEarly ? t('notOpen.closeNow') : t('notOpen.build')}
            </Button>
          ) : null
        }
      />
      <Dialog
        open={confirming}
        onClose={() => {
          if (!pending) setConfirming(false);
        }}
        canClose={() => !pending}
        size="sm"
        tone="warning"
        title={t('notOpen.confirmTitle')}
        description={t('notOpen.confirmBody')}
        closeLabel={t('close')}
        data-testid="plan-open-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button
              busy={pending}
              disabled={pending}
              onClick={open}
              data-testid="plan-open-confirm"
            >
              {t('notOpen.confirm')}
            </Button>
          </>
        }
      >
        {notice ? <Alert tone="danger">{notice}</Alert> : null}
      </Dialog>
    </div>
  );
}
