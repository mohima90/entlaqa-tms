'use client';
import { Alert, Button } from '@jadarat/ui';
import { useState, useTransition } from 'react';
import { downloadUserImportReportAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

export interface ReportDownloadButtonProps {
  readonly importId: string;
  readonly which: 'report' | 'review';
  readonly label: string;
  readonly workingLabel: string;
  /** Texts by refusal code (REPORT_DELETED, REPORT_NOT_YOURS, …). */
  readonly codes: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly variant?: 'primary' | 'secondary';
}

/**
 * Downloads the error report or the review's list of problems: a short-lived link for the importer
 * (each download audited), opened at once so the browser saves the CSV.
 */
export function ReportDownloadButton(props: ReportDownloadButtonProps) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const download = () => {
    setFailure(null);
    startTransition(async () => {
      const result = await downloadUserImportReportAction({
        importId: props.importId,
        which: props.which,
      });
      if (result.ok) {
        window.location.assign(result.value.url);
        return;
      }
      const code = fieldErrorCodes(result.error).import;
      setFailure((code ? props.codes[code] : undefined) ?? errorText(result.error, props.errors));
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={props.variant ?? 'secondary'}
          disabled={pending}
          onClick={download}
          data-testid={`download-${props.which}`}
        >
          {pending ? props.workingLabel : props.label}
        </Button>
      </div>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
    </div>
  );
}
