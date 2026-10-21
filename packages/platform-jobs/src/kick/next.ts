/**
 * Next.js adapter for the worker kick (dispatch.ts): schedules `requestWorkerPass` with `after()`, so it runs
 * AFTER the response has been sent — after every transaction of the request has finished — and never delays
 * or changes the answer. On Vercel `after()` keeps the function alive until the callback is done (bounded by
 * the dispatch's 5-second timeout).
 */
import 'server-only';
import { after } from 'next/server';
import { requestWorkerPass, workerKickConfigured } from './dispatch';

type Schedule = (task: () => Promise<unknown>) => void;

/** Testable core of `kickWorkerAfterResponse`. */
export function createAfterResponseKick(deps: {
  readonly schedule: Schedule;
  readonly configured: () => boolean;
  readonly request: (reason: string) => Promise<unknown>;
}): (reason: string) => void {
  return (reason) => {
    // No dispatch App (self-hosted, local): nothing to schedule.
    if (!deps.configured()) return;
    try {
      deps.schedule(() => deps.request(reason));
    } catch {
      // Outside a request scope (`after` refuses): ask now, without waiting. `request` never rejects.
      void deps.request(reason);
    }
  };
}

/**
 * After this request's response: ask GitHub for a worker pass (no-op without the dispatch App settings; throttled).
 * Call it only once the request's work is committed or about to be (e.g. defineAction after its commit);
 * an extra pass that finds nothing to do is harmless.
 */
export const kickWorkerAfterResponse: (reason: string) => void = createAfterResponseKick({
  schedule: (task) => {
    after(task);
  },
  configured: workerKickConfigured,
  request: requestWorkerPass,
});

/**
 * Wraps a function that queues work for the worker (e.g. an account e-mail request) so that, once it has
 * returned, a worker pass is asked for after the response. A throw is passed on and asks for nothing. When
 * `fn` writes inside a caller's transaction, the pass still starts only after the response — by then that
 * transaction has ended; had it rolled back, the pass finds nothing to do (harmless).
 */
export function kicksWorker<A extends unknown[], R>(
  reason: string,
  fn: (...args: A) => Promise<R>,
  kick: (reason: string) => void = kickWorkerAfterResponse,
): (...args: A) => Promise<R> {
  return async (...args) => {
    const result = await fn(...args);
    kick(reason);
    return result;
  };
}
