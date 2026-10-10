'use client';
import { Alert, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { reactivateMemberAction, reactivatePrivilegedMemberAction } from '../../actions/users';
import { reactivationErrorKey } from '../../lib/deactivate-form';
import { type ErrorTexts, errorText } from '../auth/error-text';

export interface ReactivateMemberButtonProps {
  readonly personId: string;
  readonly name: string;
  /** The member holds a privileged role: the privileged action (Organization Admin, AAL2). */
  readonly privileged: boolean;
  /** Texts of namespace `deactivation.reactivate` (`confirm` raw: `{name}` is filled in here). */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The users-list row variant: a shorter button text with the name for screen readers. */
  readonly compact?: boolean;
  /** Where to go after the reactivation (the page with its confirmation flash). */
  readonly successHref: string;
}

/**
 * «إعادة تفعيل المستخدم» (T-M2-09, FR-IAM-05): after a confirmation, the member's membership is active
 * again with the same roles; then the page (`successHref`) shows the new state with its confirmation. A
 * privileged member goes through the privileged action (the server checks the authenticator code again).
 */
export function ReactivateMemberButton(props: ReactivateMemberButtonProps) {
  const { labels, name } = props;
  const text = (key: string) => (labels[key] ?? key).replace('{name}', name);
  const router = useRouter();
  const questionId = useId();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  // Focus follows the step: the confirmation's button, then back to the trigger (WCAG 2.4.3).
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    (confirming ? confirmRef : triggerRef).current?.focus();
  }, [confirming]);

  const reactivate = () => {
    setOutcome(null);
    startTransition(async () => {
      const action = props.privileged ? reactivatePrivilegedMemberAction : reactivateMemberAction;
      const result = await action({ personId: props.personId });
      setConfirming(false);
      if (!result.ok) {
        const key = reactivationErrorKey(result.error);
        setOutcome({
          tone: 'danger',
          text: key ? text(key.slice('reactivate.'.length)) : errorText(result.error, props.errors),
        });
        return;
      }
      setOutcome({ tone: 'success', text: text('done') });
      router.replace(props.successHref);
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="reactivate-member">
      {outcome?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="reactivate-message">
          {outcome.text}
        </Alert>
      ) : null}
      {/* Kept rendered so the confirmation is announced when its text appears (Alert docs). */}
      <div role="status" aria-live="polite">
        {outcome?.tone === 'success' ? (
          <Alert tone="success" role="none" data-testid="reactivate-message">
            {outcome.text}
          </Alert>
        ) : null}
      </div>
      {outcome?.tone === 'success' ? null : confirming ? (
        <div className="flex flex-col gap-2" role="group" aria-labelledby={questionId}>
          <p id={questionId} className="m-0 text-sm">
            {text('confirm')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={confirmRef}
              type="button"
              className={buttonClasses()}
              disabled={pending}
              onClick={reactivate}
              data-testid="reactivate-confirm"
            >
              {pending ? text('working') : text('confirmButton')}
            </button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                moved.current = true;
                setConfirming(false);
              }}
            >
              {text('keep')}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <button
            ref={triggerRef}
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => {
              moved.current = true;
              setOutcome(null);
              setConfirming(true);
            }}
            data-testid="reactivate-button"
          >
            {props.compact ? text('rowButton') : text('button')}
            {/* The visible text stays first in the name (WCAG 2.5.3). */}
            {props.compact ? <span className="sr-only">{` (${name})`}</span> : null}
          </button>
        </div>
      )}
    </div>
  );
}
