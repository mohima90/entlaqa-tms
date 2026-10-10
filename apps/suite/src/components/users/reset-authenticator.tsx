'use client';
import { Alert, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { resetMemberMfaAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * "Reset authenticator app" on a member's profile (screen 3; FR-IAM-12, T-M2-10; PO answer 9 Oct 2026;
 * TM-0003 T-IAM-10): the Organization Admin removes the app of a member who lost it, after a code of their
 * own from the last 15 minutes (the /mfa step returns here) and a confirmation. Every sign-in session of
 * the member ends; the member is e-mailed and sets up a new app at the next sign-in; the reset is audited.
 * A login that also belongs to another organization is reset by ENTLAQA support (the answer says so).
 */
export interface ResetAuthenticatorLabels {
  readonly action: string;
  readonly needsCode: string;
  readonly verifyFirst: string;
  readonly confirmTitle: string;
  /** `{name}`: the member. */
  readonly confirmText: string;
  readonly confirm: string;
  readonly resetting: string;
  readonly cancel: string;
  /** `{name}`: the member. */
  readonly done: string;
}

export function ResetAuthenticator({
  personId,
  personName,
  needsCode,
  stepUpHref,
  labels,
  errors,
}: {
  readonly personId: string;
  readonly personName: string;
  /** No code of the admin's own from the last 15 minutes: the /mfa step first. */
  readonly needsCode: boolean;
  /** /mfa?next=<this profile>. */
  readonly stepUpHref: string;
  readonly labels: ResetAuthenticatorLabels;
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
    stepUp?: boolean;
  } | null>(null);
  const named = (text: string) => text.replaceAll('{name}', personName);

  function reset() {
    setMessage(null);
    startTransition(async () => {
      const result = await resetMemberMfaAction({ personId });
      dialog.current?.close();
      if (result.ok) {
        setMessage({ tone: 'success', text: named(labels.done) });
        router.refresh();
      } else if (result.error.code === 'STEP_UP_REQUIRED') {
        // The code is older than 15 minutes now: ask for a new one, then come back.
        setMessage({ tone: 'warning', text: labels.needsCode, stepUp: true });
      } else if (!sessionRefused(result.error)) {
        setMessage({
          tone: result.error.code === 'MFA_RESET_OTHER_ORGANIZATION' ? 'warning' : 'danger',
          text: errorText(result.error, errors),
        });
      }
    });
  }

  const verifyLink = (
    <a
      href={stepUpHref}
      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
      data-testid="user-mfa-reset-step-up"
    >
      {labels.verifyFirst}
    </a>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="user-mfa-reset">
      {needsCode ? (
        <Alert tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            <span>{labels.needsCode}</span>
            {verifyLink}
          </span>
        </Alert>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setMessage(null);
              dialog.current?.showModal();
            }}
            data-testid="user-mfa-reset-open"
          >
            {labels.action}
          </Button>
        </div>
      )}
      {message ? (
        <Alert tone={message.tone} data-testid="user-mfa-reset-message">
          <span className="flex flex-wrap items-center gap-3">
            <span>{message.text}</span>
            {message.stepUp ? verifyLink : null}
          </span>
        </Alert>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="max-w-md rounded-lg border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/40"
        data-testid="user-mfa-reset-dialog"
      >
        <h2 id={titleId} className="m-0 mb-2 text-lg font-semibold">
          {labels.confirmTitle}
        </h2>
        <p className="m-0 mb-4">{named(labels.confirmText)}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="danger"
            onClick={reset}
            disabled={pending}
            data-testid="user-mfa-reset-confirm"
          >
            {pending ? labels.resetting : labels.confirm}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {labels.cancel}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
