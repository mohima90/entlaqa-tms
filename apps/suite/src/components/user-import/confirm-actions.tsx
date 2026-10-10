'use client';
import { Alert, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { cancelUserImportAction, confirmUserImportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

export interface ConfirmActionsProps {
  readonly importId: string;
  readonly options: {
    readonly existing: 'skip' | 'upsert' | 'update_only';
    readonly defaultRole: string;
    readonly invitations: 'send' | 'hold';
  };
  readonly backHref: string;
  /** Where to go after cancelling (the users list). */
  readonly cancelledHref: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly codes: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * Step 5's buttons (approved screen 8): «بدء الاستيراد», «رجوع», and «إلغاء الاستيراد وحذف الملف» after a
 * confirmation. The run starts in the background; the page then shows its progress.
 */
export function ConfirmActions(props: ConfirmActionsProps) {
  const text = (key: string) => props.labels[key] ?? key;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Focus follows the question (WCAG 2.4.3): «رجوع» when it opens, the opener when it closes.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (confirmingCancel) {
      document.getElementById('cancel-import-keep')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      document.getElementById('cancel-import-opener')?.focus();
    }
  }, [confirmingCancel]);

  const refusal = (error: Parameters<typeof errorText>[0]) => {
    const code = fieldErrorCodes(error).import;
    return (code ? props.codes[code] : undefined) ?? errorText(error, props.errors);
  };

  const start = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await confirmUserImportAction({ importId: props.importId, ...props.options });
      if (result.ok) {
        router.push(`?started=1`);
        router.refresh();
        return;
      }
      setFailure(refusal(result.error));
    });
  };
  const cancel = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await cancelUserImportAction({ importId: props.importId });
      if (result.ok) {
        router.push(props.cancelledHref);
        return;
      }
      setFailure(refusal(result.error));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {failure ? (
        <Alert tone="danger" data-testid="confirm-error">
          {failure}
        </Alert>
      ) : null}
      {confirmingCancel ? (
        <div
          role="alertdialog"
          aria-labelledby="cancel-import-question"
          className="flex flex-col gap-3 rounded-lg border border-danger p-4"
        >
          <p id="cancel-import-question" className="m-0">
            {text('cancelConfirm')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={pending} onClick={cancel}>
              {text('cancelConfirmButton')}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              id="cancel-import-keep"
              onClick={() => {
                returnFocus.current = true;
                setConfirmingCancel(false);
              }}
            >
              {text('keep')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('back')}
        </a>
        <Button variant="primary" disabled={pending} onClick={start} data-testid="start-import">
          {pending ? text('starting') : text('start')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          id="cancel-import-opener"
          onClick={() => {
            setConfirmingCancel(true);
          }}
          data-testid="cancel-import"
        >
          {text('cancel')}
        </Button>
      </div>
    </div>
  );
}
