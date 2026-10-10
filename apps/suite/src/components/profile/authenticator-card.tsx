'use client';
import { Alert, Badge, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { removeTotpAction, requestMfaConfirmationMailAction } from '../../auth/mfa';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * My profile → the member's authenticator app (FR-IAM-12, T-M2-10): set one up (the /mfa page), or
 * remove it — Auth requires a session that passed a recent code first, so a removal without one explains
 * that and links to the code. Removing it in an organization that requires it asks for a new one at the
 * next step. A new app waits for its e-mailed confirmation (review H1): the card says so and offers to send
 * the e-mail again; the e-mail's own "not you? remove this app" link removes it.
 */
export function AuthenticatorCard({
  usesApp,
  appPending,
  setUpHref,
  labels,
  errors,
}: {
  /** A confirmed app (it counts). */
  readonly usesApp: boolean;
  /** An app waiting for its e-mailed confirmation. */
  readonly appPending: boolean;
  /** /mfa?next=… back to My profile. */
  readonly setUpHref: string;
  readonly labels: {
    readonly on: string;
    readonly off: string;
    readonly setUp: string;
    readonly remove: string;
    readonly removing: string;
    readonly removed: string;
    readonly removeNeedsCode: string;
    readonly verifyFirst: string;
    readonly removeWarning: string;
    readonly pending: string;
    readonly pendingText: string;
    readonly resend: string;
    readonly resending: string;
    readonly resent: string;
  };
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger' | 'warning';
    text: string;
    stepUp?: boolean;
  } | null>(null);

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await removeTotpAction({});
      if (result.ok) {
        setMessage({ tone: 'success', text: labels.removed });
        router.refresh();
      } else if (result.error.code === 'STEP_UP_REQUIRED') {
        setMessage({ tone: 'warning', text: labels.removeNeedsCode, stepUp: true });
      } else if (!sessionRefused(result.error)) {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const result = await requestMfaConfirmationMailAction({});
      if (result.ok) setMessage({ tone: 'success', text: labels.resent });
      else if (!sessionRefused(result.error)) {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="profile-mfa">
      <p className="m-0">
        <Badge
          tone={usesApp ? 'success' : appPending ? 'warning' : 'neutral'}
          data-testid="profile-mfa-status"
        >
          {usesApp ? labels.on : appPending ? labels.pending : labels.off}
        </Badge>
      </p>
      {message ? (
        <Alert tone={message.tone} data-testid="profile-mfa-message">
          <span className="flex flex-wrap items-center gap-3">
            <span>{message.text}</span>
            {message.stepUp ? (
              <a href={setUpHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {labels.verifyFirst}
              </a>
            ) : null}
          </span>
        </Alert>
      ) : null}
      {appPending && !usesApp ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-text-muted">{labels.pendingText}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={resend}
              disabled={pending}
              data-testid="profile-mfa-resend"
            >
              {pending ? labels.resending : labels.resend}
            </Button>
          </div>
        </div>
      ) : usesApp ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-text-muted">{labels.removeWarning}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={remove}
              disabled={pending}
              data-testid="profile-mfa-remove"
            >
              {pending ? labels.removing : labels.remove}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <a
            href={setUpHref}
            className={buttonClasses({ variant: 'secondary' })}
            data-testid="profile-mfa-set-up"
          >
            {labels.setUp}
          </a>
        </div>
      )}
    </div>
  );
}
