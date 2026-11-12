'use client';
import type { AppError } from '@jadarat/platform-core';
import { toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { REFRESH_ON_RETURN, isVersionConflict, mayRefreshOnReturn } from '../lib/latest-version';

/** Texts of the shell (namespace `shell.latest`), translated on the server. */
export interface LatestVersionTexts {
  /** «This changed while you had it open. Here is the latest version.» */
  readonly refreshed: string;
  /** «This changed while you had it open. Your entries are still here: load the latest version, …» */
  readonly offer: string;
  /** «Load the latest version» */
  readonly load: string;
}

const LatestVersionContext = createContext<LatestVersionTexts | null>(null);

/** Gives the pages inside a shell the texts of `useLatestVersion` (placed by the shells). */
export function LatestVersionProvider({
  texts,
  children,
}: {
  readonly texts: LatestVersionTexts;
  readonly children: ReactNode;
}) {
  return <LatestVersionContext.Provider value={texts}>{children}</LatestVersionContext.Provider>;
}

/**
 * A change refused because the page was older than the data (CONFLICT_VERSION) — WP-FIX-03; PO, 12 Nov
 * 2026: «why didn't the refresh happen automatically?». The page no longer asks the person to refresh by
 * hand:
 *
 *   - `refresh(error)` — for actions without typed input (submit, recall, remove, launch, archive, …): the
 *     page loads the latest version itself and the returned text says so;
 *   - `offer(error)` — for a form with typed input: nothing typed is thrown away and the version underneath
 *     is not swapped silently (that would overwrite the other person's change unseen); the returned text
 *     says what happened and a message that stays offers «Load the latest version».
 *
 * Both return null for any other error (the caller shows its usual message), and the caller's own conflict
 * text when the page has no shell texts (e.g. a test).
 */
export function useLatestVersion(): {
  readonly refresh: (error: AppError, fallback?: string) => string | null;
  readonly offer: (error: AppError, fallback?: string) => string | null;
} {
  const texts = useContext(LatestVersionContext);
  const router = useRouter();
  const refresh = useCallback(
    (error: AppError, fallback = '') => {
      if (!isVersionConflict(error)) return null;
      router.refresh();
      return texts?.refreshed ?? fallback;
    },
    [router, texts],
  );
  const offer = useCallback(
    (error: AppError, fallback = '') => {
      if (!isVersionConflict(error)) return null;
      if (!texts) return fallback;
      toast.warning(texts.offer, {
        action: {
          label: texts.load,
          onClick: () => {
            window.location.reload();
          },
        },
      });
      return texts.offer;
    },
    [texts],
  );
  return { refresh, offer };
}

/**
 * Loads the latest version when the person comes back to the tab (WP-FIX-03): pages that show a version
 * someone else may change (needs, cycle progress, lists) place it once. Quiet and careful: only after the
 * tab was away for a while, not more often than every half minute, and never while a dialog or a panel is
 * open or a form on the page has unsaved entries (`data-unsaved="true"`).
 */
export function RefreshOnReturn() {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const refreshedAt = useRef(0);
  useEffect(() => {
    const onChange = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = now;
        return;
      }
      const away = hiddenAt.current === null ? null : now - hiddenAt.current;
      hiddenAt.current = null;
      if (
        !mayRefreshOnReturn({
          awayMs: away,
          sinceRefreshMs: now - refreshedAt.current,
          dialogOpen: document.querySelector('dialog[open]') !== null,
          unsaved: document.querySelector('[data-unsaved="true"]') !== null,
        })
      ) {
        return;
      }
      refreshedAt.current = now;
      router.refresh();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, [router]);
  return <span hidden data-refresh-on-return={REFRESH_ON_RETURN.minAwayMs} />;
}
