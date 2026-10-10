'use client';
import { Alert, Badge, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { removeMfaAppAction } from '../../auth/mfa';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/** The account's authenticator app as this window sees it (re-review N1). */
export type AuthenticatorCardApp =
  | { readonly state: 'off' }
  /** Confirmed: it counts. */
  | { readonly state: 'on'; readonly factorId: string }
  /** Set up in THIS window, waiting for the e-mailed code. */
  | { readonly state: 'pending'; readonly factorId: string }
  /** Added from ANOTHER sign-in, waiting for its code: `notice` says when and with which browser. */
  | { readonly state: 'elsewhere'; readonly factorId: string; readonly notice: string };

/**
 * My profile → the member's authenticator app (FR-IAM-12, T-M2-10): set one up (the /mfa page), or remove
 * it — a confirmed app needs a recent code from it first, so a removal without one explains that and links
 * to the code. Removing it in an organization that requires it asks for a new one at the next step. A new
 * app waits for the one-time code e-mailed to its owner, entered in the window that set it up (re-review
 * N1): this window links to the code page and can cancel the set-up. An app added from ANOTHER sign-in is
 * shown with when and which browser, with Remove (the account's other sessions end) and "it was me".
 */
export function AuthenticatorCard({
  app,
  setUpHref,
  forgotPasswordHref,
  labels,
  errors,
}: {
  readonly app: AuthenticatorCardApp;
  /** /mfa?next=… back to My profile. */
  readonly setUpHref: string;
  readonly forgotPasswordHref: string;
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
    readonly enterCode: string;
    readonly cancel: string;
    readonly cancelling: string;
    readonly cancelled: string;
    readonly elsewhere: string;
    readonly removeElsewhere: string;
    readonly removedElsewhere: string;
    readonly newPassword: string;
    readonly itWasMe: string;
    readonly itWasMeText: string;
  };
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [itWasMe, setItWasMe] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger' | 'warning';
    text: string;
    stepUp?: boolean;
    newPassword?: boolean;
  } | null>(null);

  function remove(factorId: string, done: string, newPassword = false) {
    setMessage(null);
    startTransition(async () => {
      const result = await removeMfaAppAction({ factorId });
      if (result.ok) {
        setMessage({ tone: 'success', text: done, newPassword });
        router.refresh();
      } else if (result.error.code === 'STEP_UP_REQUIRED') {
        setMessage({ tone: 'warning', text: labels.removeNeedsCode, stepUp: true });
      } else if (!sessionRefused(result.error)) {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  const badge =
    app.state === 'on'
      ? { tone: 'success' as const, text: labels.on }
      : app.state === 'pending'
        ? { tone: 'warning' as const, text: labels.pending }
        : app.state === 'elsewhere'
          ? { tone: 'danger' as const, text: labels.elsewhere }
          : { tone: 'neutral' as const, text: labels.off };

  return (
    <div className="flex flex-col gap-4" data-testid="profile-mfa">
      <p className="m-0">
        <Badge tone={badge.tone} data-testid="profile-mfa-status">
          {badge.text}
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
            {message.newPassword ? (
              <a
                href={forgotPasswordHref}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                {labels.newPassword}
              </a>
            ) : null}
          </span>
        </Alert>
      ) : null}
      {app.state === 'elsewhere' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="danger" data-testid="profile-mfa-elsewhere">
            {app.notice}
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                remove(app.factorId, labels.removedElsewhere, true);
              }}
              disabled={pending}
              data-testid="profile-mfa-remove-elsewhere"
            >
              {pending ? labels.removing : labels.removeElsewhere}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setItWasMe(true);
              }}
              disabled={pending}
              aria-expanded={itWasMe}
              data-testid="profile-mfa-it-was-me"
            >
              {labels.itWasMe}
            </Button>
          </div>
          {itWasMe ? <p className="m-0 text-sm text-text-muted">{labels.itWasMeText}</p> : null}
        </div>
      ) : app.state === 'pending' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-text-muted">{labels.pendingText}</p>
          <div className="flex flex-wrap gap-3">
            <a
              href={setUpHref}
              className={buttonClasses({ variant: 'secondary' })}
              data-testid="profile-mfa-enter-code"
            >
              {labels.enterCode}
            </a>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                remove(app.factorId, labels.cancelled);
              }}
              disabled={pending}
              data-testid="profile-mfa-cancel"
            >
              {pending ? labels.cancelling : labels.cancel}
            </Button>
          </div>
        </div>
      ) : app.state === 'on' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-text-muted">{labels.removeWarning}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                remove(app.factorId, labels.removed);
              }}
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
