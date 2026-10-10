'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { signOutEndedSessionAction } from '../../auth/actions';

/**
 * On the sign-in page, for a session its organization's rules ended (T-M2-10): signs it out at Auth with
 * its own token and clears the cookies — a POST server action, never a GET side effect. Renders nothing.
 */
export function EndedSessionSignOut() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void signOutEndedSessionAction({}).then((result) => {
      if (result.ok && result.value.signedOut) router.refresh();
    });
  }, [router]);
  return null;
}
