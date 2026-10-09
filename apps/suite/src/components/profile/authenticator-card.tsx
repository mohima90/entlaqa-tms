'use client';
import { Alert, Badge, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { removeTotpAction } from '../../auth/mfa';
import { type ErrorTexts, errorText } from '../auth/error-text';

/**
 * My profile → the member's authenticator app (FR-IAM-12, T-M2-10): set one up (the /mfa page), or
 * remove it — Auth requires a session that passed a code first, so a removal at AAL1 explains that and
 * links to the code. Removing it in an organization that requires it asks for a new one at the next step.
 */
export function AuthenticatorCard({
  usesApp,
  setUpHref,
  labels,
  errors,
}: {
  readonly usesApp: boolean;
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
  };
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
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
      } else {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="profile-mfa">
      <p className="m-0">
        <Badge tone={usesApp ? 'success' : 'neutral'} data-testid="profile-mfa-status">
          {usesApp ? labels.on : labels.off}
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
      {usesApp ? (
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
