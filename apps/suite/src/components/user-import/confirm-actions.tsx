'use client';
import { Alert, Button, Dialog, Icon, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelUserImportAction, confirmUserImportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import { FocusedActions } from '../focused-actions';
import { useOptionsChanging } from './options-form';

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
 * The confirmation's buttons (approved screen 8; redesign package 3: in the focused frame's bottom bar):
 * «بدء الاستيراد», «رجوع», and «إلغاء الاستيراد وحذف الملف» after a red confirmation. The run starts in the
 * background; the page then shows its progress.
 */
export function ConfirmActions(props: ConfirmActionsProps) {
  const text = (key: string) => props.labels[key] ?? key;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A changed option is still loading: Start would send the previous choice, so it waits (busy).
  const changing = useOptionsChanging();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refusal = (error: Parameters<typeof errorText>[0]) => {
    const code = fieldErrorCodes(error).import;
    return (code ? props.codes[code] : undefined) ?? errorText(error, props.errors);
  };

  const start = () => {
    if (changing) return;
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
    <>
      {failure ? (
        <Alert tone="danger" data-testid="confirm-error">
          {failure}
        </Alert>
      ) : null}
      <FocusedActions
        start={
          <Button
            variant="ghost"
            disabled={pending}
            id="cancel-import-opener"
            onClick={() => {
              setConfirmingCancel(true);
            }}
            data-testid="cancel-import"
          >
            <Icon name="trash" className="size-4" />
            {text('cancel')}
          </Button>
        }
      >
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('back')}
        </a>
        <Button
          variant="primary"
          busy={pending || changing}
          disabled={pending || changing}
          onClick={start}
          data-testid="start-import"
        >
          <Icon name="arrow-end" />
          {pending ? text('starting') : text('start')}
        </Button>
      </FocusedActions>
      {/* Cancelling deletes the file and the review: a red confirmation (it cannot be undone). */}
      <Dialog
        open={confirmingCancel}
        onClose={() => {
          if (!pending) setConfirmingCancel(false);
        }}
        tone="danger"
        title={text('cancel')}
        description={text('cancelConfirm')}
        closeLabel={text('keep')}
        size="sm"
        data-testid="cancel-import-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={pending}
              id="cancel-import-keep"
              onClick={() => {
                setConfirmingCancel(false);
              }}
            >
              {text('keep')}
            </Button>
            <Button variant="danger" busy={pending} disabled={pending} onClick={cancel}>
              {text('cancelConfirmButton')}
            </Button>
          </>
        }
      />
    </>
  );
}
