import 'server-only';
import { createHash } from 'node:crypto';
import type { RateLimitCounter } from '@jadarat/platform-db';
import {
  LIMIT_BUCKETS,
  type LimitGate,
  type LimiterDeps,
  type RequestClient,
  accountSubject,
  clientSubject,
  errorNameOf,
  failClosed,
} from './auth-limits';

/**
 * «Email me a code» on the shared limiter (WP-ADM-05, PO 23 Oct 2026; docs/engineering/sign-in-protection.md
 * §9). Requests are limited per client, then per typed address (the database also allows one code a minute
 * per address); checks count wrong codes only, per typed address - whether or not it has an account, so the
 * counts tell nothing - and per client; the 5th wrong code in the window pauses code checks for the rest of
 * it (15 minutes), as the database kills the code itself after 5 tries. Fails closed
 * (RateLimiterUnavailableError, the generic internal error). Keys are hashed subjects, never readable.
 */

/**
 * The remembered-browser token's hash, as the database stores it (SHA-256 under a fixed domain prefix): the
 * token itself is a random 256-bit value that exists in the browser's HttpOnly cookie only.
 */
export function rememberedBrowserHash(token: string): Buffer {
  return createHash('sha256').update(`jadarat.remembered-browser.v1\n${token}`).digest();
}

/** One check of a sign-in code that reached the database. No method throws. */
export interface SignInCodeAttempt {
  /**
   * The tries left on the typed address if this check is wrong (0: this would be the last one and checks
   * pause for the rest of the window).
   */
  readonly triesIfWrong: number;
  /** The code was wrong: security events. */
  failed(): Promise<void>;
  /** The code was right: the run of wrong codes ends, the client's provisional failure is given back. */
  succeeded(): Promise<void>;
  /**
   * No code was compared (the request was expired, used up or not the typed address's): both provisional
   * failures are given back - guessing needs a live code.
   */
  released(): Promise<void>;
}

export interface SignInCodeLimiter {
  /** Per client first, then - only for an allowed client - per typed address. Throws when the limiter fails. */
  allowRequest(email: string): Promise<boolean>;
  /** Before a code is looked at: counts a provisional wrong code; refused when a budget is used up. */
  checkCode(email: string): Promise<LimitGate<SignInCodeAttempt>>;
}

export function createSignInCodeLimiter(
  deps: LimiterDeps & {
    readonly client: RequestClient;
    readonly requestAction: string;
    readonly checkAction: string;
  },
): SignInCodeLimiter {
  const limits = deps.limits.signInCode;
  const shared = deps.client.key === null;
  const clientKey = clientSubject(deps.client);
  const B = LIMIT_BUCKETS;
  const giveBack = async (bucket: string, subject: Uint8Array) => {
    try {
      await deps.store.giveBack(bucket, subject);
    } catch (error) {
      deps.log({
        event: 'auth.limiter.unavailable',
        action: deps.checkAction,
        reason: 'failure_not_given_back',
        errorName: errorNameOf(error),
      });
    }
  };
  return {
    async allowRequest(email) {
      const action = deps.requestAction;
      return failClosed(deps, action, async () => {
        const fromClient = await deps.store.hit(
          B.signInCodeRequestClient,
          clientKey,
          shared ? limits.sharedClientRequests : limits.requestsPerClient,
        );
        const refused = (limit: string, counter: RateLimitCounter) => {
          deps.log({
            event: 'auth.rate_limited',
            action,
            reason: limit,
            limit,
            retryAfterS: counter.retryAfterSeconds,
            clientRef: fromClient.ref,
          });
          return false;
        };
        // A refused client counts nowhere else: it cannot use up (or fill up) other addresses' budgets.
        if (!fromClient.allowed) return refused(B.signInCodeRequestClient, fromClient);
        const account = await deps.store.hit(
          B.signInCodeRequestAccount,
          accountSubject(email),
          limits.requestsPerAccount,
        );
        return account.allowed || refused(B.signInCodeRequestAccount, account);
      });
    },
    async checkCode(email) {
      const action = deps.checkAction;
      const account = accountSubject(email);
      const clientFailures = shared ? limits.sharedClientCheckFailures : limits.checkClientFailures;
      const [byAccount, byClient] = await failClosed(deps, action, () =>
        Promise.all([
          deps.store.hit(B.signInCodeCheckAccount, account, limits.checkAccountFailures),
          deps.store.hit(B.signInCodeCheckClient, clientKey, clientFailures),
        ]),
      );
      const refs = { subjectRef: byAccount.ref, clientRef: byClient.ref };
      if (!byAccount.allowed || !byClient.allowed) {
        // Refused before the code is looked at: it is no wrong code - the other budget gets its failure back.
        if (byAccount.allowed) await giveBack(B.signInCodeCheckAccount, account);
        if (byClient.allowed) await giveBack(B.signInCodeCheckClient, clientKey);
        const limit = byAccount.allowed ? B.signInCodeCheckClient : B.signInCodeCheckAccount;
        const retryAfterSeconds = Math.max(
          byAccount.allowed ? 0 : byAccount.retryAfterSeconds,
          byClient.allowed ? 0 : byClient.retryAfterSeconds,
        );
        deps.log({
          event: 'auth.rate_limited',
          action,
          reason: limit,
          limit,
          retryAfterS: retryAfterSeconds,
          ...refs,
        });
        return { allowed: false, retryAfterSeconds };
      }
      const attempt: SignInCodeAttempt = {
        triesIfWrong: byAccount.remaining,
        async failed() {
          deps.log({ event: 'auth.sign_in_code.failed', action, reason: 'invalid_code', ...refs });
          for (const [bucket, counter] of [
            [B.signInCodeCheckAccount, byAccount],
            [B.signInCodeCheckClient, byClient],
          ] as const) {
            if (counter.remaining === 0) {
              deps.log({
                event: 'auth.lockout',
                action,
                reason: bucket,
                limit: bucket,
                retryAfterS: counter.retryAfterSeconds,
                ...refs,
              });
            }
          }
        },
        async succeeded() {
          try {
            await deps.store.clear(B.signInCodeCheckAccount, account);
          } catch (error) {
            deps.log({
              event: 'auth.limiter.unavailable',
              action,
              reason: 'success_not_recorded',
              errorName: errorNameOf(error),
            });
          }
          await giveBack(B.signInCodeCheckClient, clientKey);
        },
        async released() {
          await giveBack(B.signInCodeCheckAccount, account);
          await giveBack(B.signInCodeCheckClient, clientKey);
        },
      };
      return { allowed: true, attempt };
    },
  };
}
