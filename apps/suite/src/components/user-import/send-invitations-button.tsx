'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { sendHeldInvitationsAction } from '../../actions/user-import';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

export interface SendInvitationsButtonProps {
  /** One import's held invitations, or these invitations. */
  readonly importId?: string;
  readonly invitationIds?: readonly string[];
  readonly label: string;
  readonly workingLabel: string;
  readonly doneText: string;
  readonly nothingText: string;
  /** The member may not invite (integration review M2): «يرسل الدعوات مدير المنظمة …». */
  readonly notAllowedText?: string;
  readonly errors: ErrorTexts;
  readonly variant?: 'primary' | 'secondary';
  readonly testId?: string;
}

/** «إرسال الدعوات (N)» / «إرسال الدعوة»: held invitations go out now, at the import's pace. */
export function SendInvitationsButton(props: SendInvitationsButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const send = () => {
    setFailure(null);
    setDone('');
    startTransition(async () => {
      const result = await sendHeldInvitationsAction(
        props.importId
          ? { importId: props.importId }
          : { invitationIds: [...(props.invitationIds ?? [])] },
      );
      if (result.ok) {
        setDone(props.doneText.replace('{count}', String(result.value.scheduled)));
        router.refresh();
        return;
      }
      const code = fieldErrorCodes(result.error).invitations;
      setFailure(
        code === 'NOTHING_TO_SEND'
          ? props.nothingText
          : code === 'SEND_NOT_ALLOWED' && props.notAllowedText
            ? props.notAllowedText
            : errorText(result.error, props.errors),
      );
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={props.variant ?? 'primary'}
          disabled={pending}
          onClick={send}
          data-testid={props.testId ?? 'send-invitations'}
        >
          {pending ? props.workingLabel : props.label}
        </Button>
      </div>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      <div role="status" aria-live="polite">
        {done ? (
          <Alert tone="success" role="none">
            {done}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
