'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps a settings page fresh while a test e-mail waits for the worker (queued or being sent): the server
 * page is re-read every 15 seconds until the test is finished (WP-ADM-01). Renders nothing.
 */
export function RefreshWhileTesting({ active }: { readonly active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      router.refresh();
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [active, router]);
  return null;
}
