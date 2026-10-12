/**
 * The import page's poller (T-M2-12 integration review L1). While the worker works, the page asks every
 * few seconds whether anything changed — a passive read that is not the session's activity — and
 * refreshes itself (a real request) only when it did. It asks nothing while the tab is hidden, stops for
 * good when the import is gone or the session ended (one refresh lets the page decide), and pauses while
 * the inactivity warning is shown — so a page left open never keeps an idle session alive.
 */

export type StatusAnswer =
  | { readonly kind: 'version'; readonly version: string }
  /** 401, 403, 404 or a redirect (the session ended, the import is not visible any more). */
  | { readonly kind: 'gone' }
  /** A network error or a server error: asked again next time. */
  | { readonly kind: 'error' };

export interface StatusPollerDeps {
  readonly read: () => Promise<StatusAnswer>;
  readonly refresh: () => void;
  readonly visible: () => boolean;
  /** Runs `fn` after `ms`; returns its cancel. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
}

export interface StatusPoller {
  /** The inactivity warning is shown: ask nothing until resumed. */
  pause(): void;
  /** The member chose to stay signed in. */
  resume(): void;
  stop(): void;
}

export function startStatusPoller(
  deps: StatusPollerDeps,
  options: { readonly seconds: number; readonly version: string },
): StatusPoller {
  // Read through a function: pause() and stop() change it while a read is awaited.
  const poller: { state: 'running' | 'paused' | 'stopped' } = { state: 'running' };
  const running = () => poller.state === 'running';
  let cancel: (() => void) | null = null;
  const next = () => {
    cancel?.();
    cancel = deps.schedule(() => {
      void tick();
    }, options.seconds * 1000);
  };
  const tick = async () => {
    cancel = null;
    if (!running()) return;
    if (!deps.visible()) {
      next();
      return;
    }
    const answer = await deps.read();
    if (!running()) return;
    if (answer.kind === 'gone') {
      poller.state = 'stopped';
      deps.refresh();
      return;
    }
    if (answer.kind === 'version' && answer.version !== options.version) deps.refresh();
    next();
  };
  next();
  return {
    pause() {
      if (poller.state !== 'running') return;
      poller.state = 'paused';
      cancel?.();
      cancel = null;
    },
    resume() {
      if (poller.state !== 'paused') return;
      poller.state = 'running';
      next();
    },
    stop() {
      poller.state = 'stopped';
      cancel?.();
      cancel = null;
    },
  };
}

/** One passive status read (no redirect followed: a redirect means the session ended). */
export async function readImportStatus(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<StatusAnswer> {
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      redirect: 'manual',
    });
    if (response.type === 'opaqueredirect' || [401, 403, 404].includes(response.status)) {
      return { kind: 'gone' };
    }
    if (!response.ok) return { kind: 'error' };
    const body: unknown = await response.json();
    const version =
      typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : null;
    return typeof version === 'string' ? { kind: 'version', version } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/** Window events of the inactivity warning (components/idle-warning.tsx), for pages that poll. */
export const IDLE_WARNING_SHOWN = 'jadarat:idle-warning-shown';
export const IDLE_WARNING_DISMISSED = 'jadarat:idle-warning-dismissed';
