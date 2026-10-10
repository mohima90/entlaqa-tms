'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface ImportPollerProps {
  /** Seconds between refreshes of the page (its server component reads the import again). */
  readonly seconds: number;
  /**
   * The phase as a sentence («بدأت إضافة الأشخاص وإسناد الأدوار.»). Announced politely when it changes —
   * only phase changes, never every number (design README §13).
   */
  readonly announcement: string;
}

/**
 * Keeps a waiting page current while the worker works (scan, reading, dry run, run, undo): the page is
 * refreshed every few seconds; nothing redirects by itself.
 */
export function ImportPoller({ seconds, announcement }: ImportPollerProps) {
  const router = useRouter();
  const first = useRef(announcement);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router, seconds]);

  useEffect(() => {
    // The first phase is on the page already; later ones are announced.
    if (announcement !== first.current) setSpoken(announcement);
  }, [announcement]);

  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="import-announcer">
      {spoken}
    </div>
  );
}
