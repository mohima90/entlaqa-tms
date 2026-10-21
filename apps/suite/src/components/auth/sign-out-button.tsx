'use client';
import { Button, Icon } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { signOutAction } from '../../auth/actions';

/**
 * Sign out on the focused pages (MFA, choose an organization): an outline pill with the sign-out icon
 * (direction C); on phones the icon only, its name kept for screen readers.
 */
export function SignOutButton({
  locale,
  label,
  pendingLabel,
}: {
  readonly locale: string;
  readonly label: string;
  readonly pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      busy={pending}
      data-testid="sign-out"
      className="max-md:size-11 max-md:px-0"
      onClick={() => {
        startTransition(async () => {
          // The session is revoked server-side; go to sign-in whatever the outcome.
          await signOutAction({});
          router.replace(`/${locale}/sign-in`);
          router.refresh();
        });
      }}
    >
      {pending ? null : <Icon name="sign-out" className="rtl:-scale-x-100" />}
      <span className="max-md:sr-only">{pending ? pendingLabel : label}</span>
    </Button>
  );
}
