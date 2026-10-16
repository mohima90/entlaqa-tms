'use client';
import { UserMenu, type UserMenuProps } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { signOutAction } from '../auth/actions';

/**
 * The account menu of the top bar (Kawadir avatar menu, T-M2-43): name and "Organization · Role", My
 * profile, and sign-out when sign-in is configured. The session is revoked on the server; the page then
 * goes to sign-in whatever the outcome (as the former sign-out button, FR-IAM-16).
 */
export function AccountMenu({
  locale,
  canSignOut,
  ...props
}: Omit<UserMenuProps, 'onSignOut'> & { readonly locale: string; readonly canSignOut: boolean }) {
  const router = useRouter();
  return (
    <UserMenu
      {...props}
      onSignOut={
        canSignOut
          ? async () => {
              await signOutAction({});
              router.replace(`/${locale}/sign-in`);
              router.refresh();
            }
          : undefined
      }
    />
  );
}
