'use client';
import { Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { signOutAction } from '../../auth/actions';

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
      data-testid="sign-out"
      onClick={() => {
        startTransition(async () => {
          // The session is revoked server-side; go to sign-in whatever the outcome.
          await signOutAction({});
          router.replace(`/${locale}/sign-in`);
          router.refresh();
        });
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
