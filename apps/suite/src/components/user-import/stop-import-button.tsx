'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { stopUserImportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';

export interface StopImportButtonProps {
  readonly importId: string;
  /** «إيقاف الاستيراد؟» and its body (count filled in on the server), the buttons. */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * «إيقاف الاستيراد» (approved screen 13, stop dialog): an alert dialog; the import stops after its current
 * batch, people added so far stay without invitations. «رجوع» returns the focus to the button.
 */
export function StopImportButton({ importId, labels, errors }: StopImportButtonProps) {
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const returnFocus = useRef(false);
  // Focus follows the dialog (WCAG 2.4.3): «رجوع» when it opens, the opener when it closes.
  useEffect(() => {
    if (open) {
      document.getElementById('stop-import-keep')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      document.getElementById('stop-import-opener')?.focus();
    }
  }, [open]);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const stop = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await stopUserImportAction({ importId });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      setFailure(errorText(result.error, errors));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {open ? (
        <div
          role="alertdialog"
          aria-labelledby="stop-import-title"
          aria-describedby="stop-import-body"
          className="flex flex-col gap-3 rounded-lg border border-danger bg-surface p-4"
          data-testid="stop-dialog"
        >
          <h2 id="stop-import-title" className="m-0 text-lg font-semibold">
            {text('stopTitle')}
          </h2>
          <p id="stop-import-body" className="m-0">
            {text('stopBody')}
          </p>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={pending} onClick={stop} data-testid="stop-confirm">
              {pending ? text('working') : text('stopConfirm')}
            </Button>
            <Button
              variant="secondary"
              id="stop-import-keep"
              disabled={pending}
              onClick={() => {
                returnFocus.current = true;
                setOpen(false);
              }}
            >
              {text('keep')}
            </Button>
          </div>
        </div>
      ) : null}
      <div>
        <Button
          id="stop-import-opener"
          variant="danger-outline"
          onClick={() => {
            setOpen(true);
          }}
          data-testid="stop-import"
        >
          {text('stop')}
        </Button>
      </div>
    </div>
  );
}
