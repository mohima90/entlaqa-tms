'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { undoUserImportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

const REASONS = ['wrong_file', 'wrong_data', 'wrong_options', 'other'] as const;
type Reason = (typeof REASONS)[number];

export interface UndoImportDialogProps {
  readonly importId: string;
  /** The dialog's sentences, formatted on the server (counts, file name, deadline). */
  readonly sentences: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly codes: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * «التراجع عن الاستيراد» (approved screen 12, BRD §10.4): what the undo removes, keeps and restores, an
 * optional reason for the audit log, and the confirmation. It cannot itself be undone.
 */
export function UndoImportDialog(props: UndoImportDialogProps) {
  const text = (key: string) => props.labels[key] ?? key;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const returnFocus = useRef(false);
  // Focus follows the dialog (WCAG 2.4.3): its safe button when it opens, the opener when it closes.
  useEffect(() => {
    if (open) {
      document.getElementById('undo-import-back')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      document.getElementById('undo-import-opener')?.focus();
    }
  }, [open]);
  const [reason, setReason] = useState<Reason | ''>('');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const undo = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await undoUserImportAction({
        importId: props.importId,
        reason: reason === '' ? null : reason,
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const code = fieldErrorCodes(result.error).import;
      setFailure((code ? props.codes[code] : undefined) ?? errorText(result.error, props.errors));
    });
  };

  if (!open) {
    return (
      <div>
        <Button
          id="undo-import-opener"
          variant="danger-outline"
          onClick={() => {
            setOpen(true);
          }}
          data-testid="undo-import"
        >
          {text('undoAction')}
        </Button>
      </div>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-labelledby="undo-import-title"
      className="flex flex-col gap-3 rounded-lg border border-danger bg-surface p-4"
      data-testid="undo-dialog"
    >
      <h2 id="undo-import-title" className="m-0 text-lg font-semibold">
        {text('title')}
      </h2>
      {props.sentences.map((sentence, i) => (
        <p key={i} className="m-0">
          {sentence}
        </p>
      ))}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 font-medium">{text('reason')}</legend>
        {(['', ...REASONS] as const).map((value) => (
          <label key={value || 'none'} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="undo-reason"
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
              }}
              className="size-5"
            />
            {value === '' ? text('noReason') : text(`reasons.${value}`)}
          </label>
        ))}
      </fieldset>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          id="undo-import-back"
          disabled={pending}
          onClick={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
        >
          {text('back')}
        </Button>
        <Button variant="danger" disabled={pending} onClick={undo} data-testid="undo-confirm">
          {pending ? text('working') : text('confirm')}
        </Button>
      </div>
    </div>
  );
}
