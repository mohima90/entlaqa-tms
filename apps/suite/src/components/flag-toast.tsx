'use client';
import { toast } from '@jadarat/ui';
import { useEffect, useRef } from 'react';

/**
 * A one-time confirmation that came with the address (e.g. `?launched=1` after a launch, `?deleted=1`
 * after a draft was deleted) shown as a toast instead of a banner (redesign package 4): shown once on
 * load, then the flag is taken out of the address so a reload or a shared link does not repeat it.
 */
export function FlagToast({
  message,
  param,
}: {
  readonly message: string;
  readonly param: string;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.success(message);
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, [message, param]);
  return null;
}
