'use client';
import { Alert, Button, Dialog } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { resetMemberMfaAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * "Reset authenticator app" on a member's profile (screen 3; FR-IAM-12, T-M2-10; PO answer 9 Oct 2026;
 * TM-0003 T-IAM-10): the Organization Admin removes the app of a member who lost it, after a confirmation
 * (no authenticator code of their own: PO decision, 14 Oct 2026). Every sign-in session of
 * the member ends; the member is e-mailed and sets up a new app at the next sign-in; the reset is audited.
 * A login that also belongs to another organization is reset by ENTLAQA support (the answer says so).
 */
export interface ResetAuthenticatorLabels {
  readonly title: string;
  readonly hint: string;
  readonly support: string;
  readonly action: string;
  readonly confirmTitle: string;
  /** `{name}`: the member. */
  readonly confirmText: string;
  readonly confirm: string;
  readonly resetting: string;
  readonly cancel: string;
  /** «Close»: the ✕ in the corner — its own name, not «Cancel» again (two buttons, two names). */
  readonly close: string;
  /** `{name}`: the member. */
  readonly done: string;
}

export function ResetAuthenticator({
  personId,
  personName,
  hasApp,
  canReset,
  labels,
  errors,
}: {
  readonly personId: string;
  readonly personName: string;
  /** The member has an app (confirmed or waiting for its confirmation): something to reset. */
  readonly hasApp: boolean;
  /** The caller may reset it (Organization Admin); others read how a lost app is reset. */
  readonly canReset: boolean;
  readonly labels: ResetAuthenticatorLabels;
  readonly errors: ErrorTexts;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const named = (text: string) => text.replaceAll('{name}', personName);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  // Escape, ✕ and the backdrop wait while the reset is running.
  const canClose = useCallback(() => !pending, [pending]);

  function reset() {
    setMessage(null);
    startTransition(async () => {
      const result = await resetMemberMfaAction({ personId });
      setOpen(false);
      if (result.ok) {
        setMessage({ tone: 'success', text: named(labels.done) });
        router.refresh();
      } else if (!sessionRefused(result.error)) {
        setMessage({
          tone: result.error.code === 'MFA_RESET_OTHER_ORGANIZATION' ? 'warning' : 'danger',
          text: errorText(result.error, errors),
        });
      }
    });
  }

  // Kept mounted after a reset (the page refreshes without the app) so its answer stays on screen.
  if (!hasApp && message === null) return null;
  return (
    <div
      className="mt-5 flex flex-col gap-3 border-t border-border pt-4"
      data-testid="user-mfa-reset"
    >
      {hasApp ? (
        <>
          <h3 className="m-0 text-base font-semibold">{labels.title}</h3>
          <p className="m-0 text-sm text-text-muted">{labels.hint}</p>
          <p className="m-0 text-sm text-text-muted" data-testid="user-mfa-reset-support">
            {labels.support}
          </p>
        </>
      ) : null}
      {!hasApp || !canReset ? null : (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMessage(null);
              setOpen(true);
            }}
            data-testid="user-mfa-reset-open"
          >
            {labels.action}
          </Button>
        </div>
      )}
      {message ? (
        <Alert tone={message.tone} data-testid="user-mfa-reset-message">
          {message.text}
        </Alert>
      ) : null}
      {/* The shared confirmation popup (forms standard rule 9; before: a hand-made <dialog>): the page
          behind is inert, Escape and «Cancel» close it, focus returns to the button that opened it. */}
      <Dialog
        open={open}
        onClose={close}
        canClose={canClose}
        size="sm"
        tone="danger"
        title={labels.confirmTitle}
        description={named(labels.confirmText)}
        closeLabel={labels.close}
        data-testid="user-mfa-reset-dialog"
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={close}>
              {labels.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={reset}
              disabled={pending}
              aria-busy={pending || undefined}
              data-testid="user-mfa-reset-confirm"
            >
              {pending ? labels.resetting : labels.confirm}
            </Button>
          </>
        }
      />
    </div>
  );
}
