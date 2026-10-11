'use client';
import { Alert, Button } from '@jadarat/ui';
import { useState, useTransition } from 'react';
import { unlockSignInAction } from '../../actions/users';
import { type ErrorTexts, errorText } from '../auth/error-text';

export interface UnlockSignInProps {
  readonly personId: string;
  /** Texts formatted on the server (no client-side i18n runtime). */
  readonly labels: {
    readonly title: string;
    readonly body: string;
    readonly unlock: string;
    readonly unlocking: string;
    readonly unlocked: string;
    readonly notLocked: string;
    /** Refused: 3 unlocks of this account within 24 hours already (the lock stays). */
    readonly limited: string;
    readonly audited: string;
  };
  readonly errors: ErrorTexts;
}

interface Outcome {
  readonly tone: 'success' | 'danger';
  readonly text: string;
}

/**
 * «إلغاء إيقاف تسجيل الدخول» (T-M2-11, PO decision 9 Oct 2026): shown on a member's profile to the
 * Organization Admin only while the member's account is locked after repeated failed sign-ins. One click
 * ends the lock (audited; the member is e-mailed); the outcome is announced politely in place of the
 * notice (the next visit of the profile shows no lock). A fourth unlock of the account within 24 hours is
 * refused (security review M1): announced as an error, the notice stays.
 */
export function UnlockSignIn({ personId, labels, errors }: UnlockSignInProps) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const unlock = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await unlockSignInAction({ personId });
      if (!result.ok) {
        setOutcome({ tone: 'danger', text: errorText(result.error, errors) });
      } else if (result.value.outcome === 'limited') {
        setOutcome({ tone: 'danger', text: labels.limited });
      } else {
        setOutcome({
          tone: 'success',
          text: result.value.outcome === 'unlocked' ? labels.unlocked : labels.notLocked,
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sign-in-lock">
      {outcome?.tone === 'success' ? null : (
        <Alert tone="warning" title={labels.title}>
          <p className="m-0">{labels.body}</p>
          <p className="mb-0 mt-2 text-sm">{labels.audited}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={unlock}
            disabled={pending}
            aria-busy={pending}
            data-testid="unlock-sign-in"
          >
            {pending ? labels.unlocking : labels.unlock}
          </Button>
        </Alert>
      )}
      {outcome?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="unlock-sign-in-message">
          {outcome.text}
        </Alert>
      ) : null}
      {/* Kept rendered so a confirmation is announced when its text changes (Alert docs). */}
      <div role="status" aria-live="polite">
        {outcome?.tone === 'success' ? (
          <Alert tone="success" role="none" data-testid="unlock-sign-in-message">
            {outcome.text}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
