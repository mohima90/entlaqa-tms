'use client';
import type { AppError } from '@jadarat/platform-core';
import { Button, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  REFRESH_ON_RETURN,
  formTakesLatest,
  isVersionConflict,
  mayRefreshOnReturn,
} from '../lib/latest-version';

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
      // Every form that offers shows the button under its own message (`LoadLatestVersion`; review M3,
      // second look L3) — that is what the person can always reach. The page's message is an extra for
      // forms on the page itself: under a side panel or a dialog (a modal) it could not be reached, so it
      // is left out there.
      if (document.querySelector('dialog:modal')) return texts.offer;
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
 * «Load the latest version» inside a form's own message (review M3): the offer of `useLatestVersion` is a
 * message of the page, which a side panel or a dialog covers and makes unreachable — a form in one places
 * this under its message, and it shows when that message is the offer.
 */
export function LoadLatestVersion({ message }: { readonly message: string | null | undefined }) {
  const texts = useContext(LatestVersionContext);
  if (!texts || message !== texts.offer) return null;
  return (
    <span className="mt-2 block">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          window.location.reload();
        }}
        data-testid="load-latest-version"
      >
        {texts.load}
      </Button>
    </span>
  );
}

/**
 * The copy of the data a form's fields were read from, and its version (review H1). A form keeps its fields
 * in state, read once; when the page loads a newer copy underneath (`router.refresh()`, `RefreshOnReturn`)
 * the form must not send the newer version with its older fields. So:
 *
 *   - nothing typed → the form takes the latest copy: `take(latest)` resets its fields, and it sends the
 *     latest version;
 *   - something typed → it keeps the copy and the version it started from; saving is refused as a conflict
 *     and the person is offered «Load the latest version», as before the automatic reload existed.
 *
 * `isDirty(initial)` compares the fields with the copy they came from (not with the latest props, or an
 * untouched form would look unsaved after a reload).
 *
 * The department answers of the needs page use it for the first half only: that save carries no version
 * (the answers are written by the department's head alone, so only the same head in two tabs can collide
 * and the last save wins) — untouched answers follow the latest copy, typed ones stay (second look L2).
 */
export function useFormBase<T>(
  current: { readonly version: number; readonly initial: T },
  isDirty: (initial: T) => boolean,
  take: (latest: T) => void,
): { readonly version: number; readonly initial: T; readonly dirty: boolean } {
  const [base, setBase] = useState(current);
  const dirty = isDirty(base.initial);
  if (formTakesLatest({ base: base.version, current: current.version, dirty })) {
    // Adjusting state while rendering, as React documents for «a prop changed»: one extra render.
    setBase(current);
    take(current.initial);
    return { version: current.version, initial: current.initial, dirty: false };
  }
  return { version: base.version, initial: base.initial, dirty };
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
