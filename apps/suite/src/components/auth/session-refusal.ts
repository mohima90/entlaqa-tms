'use client';
import type { AppError } from '@jadarat/platform-core';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * A session the database no longer lets act (security review L1, T-M2-10): ended by inactivity, its maximum
 * length, the device limit, a force sign-out or "sign out everywhere", or refused by the organization's MFA
 * policy. Every tenant action then answers UNAUTHENTICATED. Instead of showing "sign in to continue" on a
 * page that no longer works, the page is loaded again: the server sends the member where the session
 * stands (the sign-in page saying why it ended, or the /mfa page). Returns whether it handled the error.
 */
export function useSessionRefusal(): (error: AppError) => boolean {
  const router = useRouter();
  return useCallback(
    (error: AppError) => {
      if (error.code !== 'UNAUTHENTICATED') return false;
      router.refresh();
      return true;
    },
    [router],
  );
}
