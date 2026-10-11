'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  IDLE_WARNING_DISMISSED,
  IDLE_WARNING_SHOWN,
  readImportStatus,
  startStatusPoller,
} from '../../lib/import-polling';

export interface ImportPollerProps {
  /** Seconds between two status reads while the worker works. */
  readonly seconds: number;
  /** The passive status read of this import (`…/import/<id>/status`). */
  readonly statusUrl: string;
  /** The version the page was rendered with: the page refreshes itself when the status read differs. */
  readonly version: string;
  /**
   * The phase as a sentence («بدأت إضافة الأشخاص وإسناد الأدوار.»). Announced politely when it changes —
   * only phase changes, never every number (design README §13).
   */
  readonly announcement: string;
}

/**
 * Keeps a waiting page current while the worker works (scan, reading, dry run, run, undo) without keeping
 * an idle session alive (T-M2-12 integration review L1): it polls a passive status read — not the
 * session's activity — and refreshes the page only when something changed; it asks nothing while the tab
 * is hidden or the inactivity warning is shown. Nothing redirects by itself.
 */
export function ImportPoller({ seconds, statusUrl, version, announcement }: ImportPollerProps) {
  const router = useRouter();
  const first = useRef(announcement);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    const poller = startStatusPoller(
      {
        read: () => readImportStatus(statusUrl),
        refresh: () => {
          router.refresh();
        },
        visible: () => document.visibilityState === 'visible',
        schedule: (fn, ms) => {
          const timer = window.setTimeout(fn, ms);
          return () => {
            window.clearTimeout(timer);
          };
        },
      },
      { seconds, version },
    );
    const pause = () => {
      poller.pause();
    };
    const resume = () => {
      poller.resume();
    };
    window.addEventListener(IDLE_WARNING_SHOWN, pause);
    window.addEventListener(IDLE_WARNING_DISMISSED, resume);
    return () => {
      poller.stop();
      window.removeEventListener(IDLE_WARNING_SHOWN, pause);
      window.removeEventListener(IDLE_WARNING_DISMISSED, resume);
    };
  }, [router, seconds, statusUrl, version]);

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
