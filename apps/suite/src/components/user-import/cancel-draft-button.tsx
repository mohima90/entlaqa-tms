'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { cancelUserImportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

export interface CancelDraftButtonProps {
  readonly importId: string;
  /** The button's text, e.g. «إلغاء الاستيراد وحذف الملف» or «إعادة الرفع». */
  readonly label: string;
  /** Read after the label by screen readers (e.g. the file's name in a table row). */
  readonly srDetail?: string;
  readonly workingLabel: string;
  /** Asked first when given (cancelling deletes the file); otherwise the import is cancelled at once. */
  readonly confirm?: {
    readonly question: string;
    readonly confirmButton: string;
    readonly keep: string;
  };
  /** Where to go once cancelled (e.g. step 1 to upload again); otherwise the page is refreshed. */
  readonly then?: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  /** Texts by refusal code (`userImport.confirm.errors`). */
  readonly codes: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly testId?: string;
}

/**
 * Cancels an import that has not run (integration review M1): from a cut upload's card and the recent
 * imports list, so an unfinished import never has to wait for its window to end. «إعادة الرفع» cancels the
 * old import first, then opens step 1. An import that is no longer a draft (it expired or was cancelled
 * meanwhile) needs nothing more: the page moves on as if it had been cancelled here.
 */
export function CancelDraftButton(props: CancelDraftButtonProps) {
  const router = useRouter();
  const questionId = useId();
  const keepId = useId();
  const openerId = useId();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const returnFocus = useRef(false);
  // Focus follows the question (WCAG 2.4.3): «رجوع» when it opens, the opener when it closes.
  useEffect(() => {
    if (asking) document.getElementById(keepId)?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      document.getElementById(openerId)?.focus();
    }
  }, [asking, keepId, openerId]);

  const cancel = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await cancelUserImportAction({ importId: props.importId });
      const code = result.ok ? null : fieldErrorCodes(result.error).import;
      if (result.ok || code === 'IMPORT_STATE_CHANGED') {
        setAsking(false);
        if (props.then) router.push(props.then);
        else router.refresh();
        return;
      }
      setFailure((code ? props.codes[code] : undefined) ?? errorText(result.error, props.errors));
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {asking && props.confirm ? (
        <div
          role="alertdialog"
          aria-labelledby={questionId}
          className="flex flex-col gap-3 rounded-lg border border-danger p-4"
        >
          <p id={questionId} className="m-0 whitespace-normal">
            {props.confirm.question}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={pending} onClick={cancel}>
              {pending ? props.workingLabel : props.confirm.confirmButton}
            </Button>
            <Button
              id={keepId}
              variant="secondary"
              disabled={pending}
              onClick={() => {
                returnFocus.current = true;
                setAsking(false);
              }}
            >
              {props.confirm.keep}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            id={openerId}
            variant={props.variant ?? 'secondary'}
            disabled={pending}
            data-testid={props.testId}
            onClick={() => {
              if (props.confirm) setAsking(true);
              else cancel();
            }}
          >
            {pending ? props.workingLabel : props.label}
            {props.srDetail ? <span className="sr-only">{` (${props.srDetail})`}</span> : null}
          </Button>
        </div>
      )}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
    </div>
  );
}
