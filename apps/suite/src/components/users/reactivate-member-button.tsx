'use client';
import { Alert, Button, Dialog, Icon, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reactivateMemberAction, reactivatePrivilegedMemberAction } from '../../actions/users';
import { reactivationErrorKey } from '../../lib/deactivate-form';
import { type ErrorTexts, errorText } from '../auth/error-text';

export interface ReactivateMemberButtonProps {
  readonly personId: string;
  readonly name: string;
  /** The member holds a privileged role: the privileged action (Organization Admin). */
  readonly privileged: boolean;
  /** Texts of namespace `deactivation.reactivate` (`confirm` raw: `{name}` is filled in here). */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The users-list row variant: a shorter button text with the name for screen readers. */
  readonly compact?: boolean;
  /**
   * The list: the toast offers «فتح الملف الكامل» / "Open full profile" (its label and address). On the
   * profile the page simply shows the new state.
   */
  readonly openProfile?: { readonly label: string; readonly href: string } | undefined;
}

/**
 * «إعادة تفعيل المستخدم» (T-M2-09, FR-IAM-05; redesign package 3): the confirmation is kept (it gives
 * sign-in back), in a dialog; then the member's membership is active again with the same roles, the page
 * refreshes and a toast says so. A privileged member goes through the privileged action.
 */
export function ReactivateMemberButton(props: ReactivateMemberButtonProps) {
  const { labels, name } = props;
  const text = (key: string) => (labels[key] ?? key).replace('{name}', name);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reactivate = () => {
    setFailure(null);
    startTransition(async () => {
      const action = props.privileged ? reactivatePrivilegedMemberAction : reactivateMemberAction;
      const result = await action({ personId: props.personId });
      if (!result.ok) {
        const key = reactivationErrorKey(result.error);
        setFailure(
          key ? text(key.slice('reactivate.'.length)) : errorText(result.error, props.errors),
        );
        return;
      }
      setOpen(false);
      const profile = props.openProfile;
      toast.success(text('done'), {
        action: profile
          ? {
              label: profile.label,
              onClick: () => {
                router.push(profile.href);
              },
            }
          : undefined,
      });
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="secondary"
        size={props.compact ? 'sm' : 'md'}
        onClick={() => {
          setFailure(null);
          setOpen(true);
        }}
        data-testid="reactivate-button"
      >
        <Icon name="sync" className="size-4" />
        {props.compact ? text('rowButton') : text('button')}
        {/* The visible text stays first in the name (WCAG 2.5.3). */}
        {props.compact ? <span className="sr-only">{` (${name})`}</span> : null}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={text('button')}
        description={text('confirm')}
        closeLabel={text('keep')}
        size="sm"
        data-testid="reactivate-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {text('keep')}
            </Button>
            <Button busy={pending} onClick={reactivate} data-testid="reactivate-confirm">
              {pending ? text('working') : text('confirmButton')}
            </Button>
          </>
        }
      >
        {failure ? (
          <Alert tone="danger" data-testid="reactivate-message">
            {failure}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
