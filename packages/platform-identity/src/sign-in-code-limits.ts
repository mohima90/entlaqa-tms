import 'server-only';
import { createHash } from 'node:crypto';
import type { RateLimit, RateLimitCounter } from '@jadarat/platform-db';
import {
  ALL_CLIENTS_SUBJECT,
  LIMIT_BUCKETS,
  type LimitGate,
  type LimiterDeps,
  type RequestClient,
  accountSubject,
  clientSubject,
  codeMissesClientKey,
  errorNameOf,
  failClosed,
  rememberedBrowserSubject,
} from './auth-limits';

/**
 * «Email me a code» on the shared limiter (WP-ADM-05, PO 23 Oct 2026; docs/engineering/sign-in-protection.md
 * §9). Requests are limited per client (an IPv6 client by its /48), then per typed address (15 minutes and a
 * day; the database also allows one code a minute per address); checks count wrong codes only, per typed
 * address - whether or not it has an account, so the counts tell nothing - per client and for all clients
 * together (security review M2); the 5th wrong code in the window pauses code checks for the rest of it
 * (15 minutes), as the database kills the code itself after 5 tries. The address's budget follows the
 * organization's lock-out policy where it applies (L2), and a REMEMBERED browser is not stopped by the typed
 * address's pause - it has its own budget (M3), as a trusted browser has at the password step. Fails closed
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
  /** The code was right: the run of wrong codes ends, the provisional failures are given back. */
  succeeded(): Promise<void>;
  /**
   * No code was compared (the request was expired, used up or not the typed address's): the provisional
   * failures are given back - guessing needs a live code.
   */
  released(): Promise<void>;
}

export interface SignInCodeLimiter {
  /**
   * Per client first, then - only for an allowed client - per typed address (not for a remembered browser:
   * `trusted` is asked only then, and such a browser needs no code). Throws when the limiter fails.
   */
  readonly allowRequest: (
    email: string,
    options?: { readonly trusted?: () => Promise<boolean> },
  ) => Promise<boolean>;
  /**
   * Before a code is looked at: counts a provisional wrong code; refused when a budget is used up.
   * `rememberedToken`: the browser is remembered for this address (checked by the caller) - its own budget
   * replaces the typed address's.
   */
  readonly checkCode: (
    email: string,
    options?: { readonly rememberedToken?: string | null },
  ) => Promise<LimitGate<SignInCodeAttempt>>;
}

export function createSignInCodeLimiter(
  deps: LimiterDeps & {
    readonly client: RequestClient;
    readonly requestAction: string;
    readonly checkAction: string;
    /**
     * The typed address's budget of wrong codes under the organization's lock-out policy (the password step's
     * `organizationAccountLockout`); the platform default when absent.
     */
    readonly accountBudget?: ((email: string) => Promise<RateLimit>) | undefined;
  },
): SignInCodeLimiter {
  const limits = deps.limits.signInCode;
  const shared = deps.client.key === null;
  // An IPv6 client by its /48 (a site holds a whole /48: /64 keys would give one guesser 65,536 budgets).
  const clientKey = clientSubject(codeMissesClientKey(deps.client));
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
    async allowRequest(email, options) {
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
        // A remembered browser asks for no code: the address's ceilings (an attacker's way to keep the owner
        // from asking) do not apply to it.
        if (options?.trusted && (await options.trusted())) return true;
        const account = await deps.store.hit(
          B.signInCodeRequestAccount,
          accountSubject(email),
          limits.requestsPerAccount,
        );
        if (!account.allowed) return refused(B.signInCodeRequestAccount, account);
        const daily = await deps.store.hit(
          B.signInCodeRequestAccountDaily,
          accountSubject(email),
          limits.requestsPerAccountDaily,
        );
        return daily.allowed || refused(B.signInCodeRequestAccountDaily, daily);
      });
    },
    async checkCode(email, options) {
      const action = deps.checkAction;
      const token = options?.rememberedToken ?? null;
      // The address's own budget (the organization's lock-out policy where it applies) - or, for a remembered
      // browser, that browser's.
      const accountBucket =
        token === null ? B.signInCodeCheckAccount : B.signInCodeCheckRememberedBrowser;
      const account = token === null ? accountSubject(email) : rememberedBrowserSubject(token);
      const budgetOf = deps.accountBudget;
      const accountLimit =
        token !== null
          ? limits.checkRememberedBrowserFailures
          : budgetOf
            ? await failClosed(deps, action, () => budgetOf(email))
            : limits.checkAccountFailures;
      const clientFailures = shared ? limits.sharedClientCheckFailures : limits.checkClientFailures;
      const [byAccount, byClient] = await failClosed(deps, action, () =>
        Promise.all([
          deps.store.hit(accountBucket, account, accountLimit),
          deps.store.hit(B.signInCodeCheckClient, clientKey, clientFailures),
        ]),
      );
      const refs = { subjectRef: byAccount.ref, clientRef: byClient.ref };
      if (!byAccount.allowed || !byClient.allowed) {
        // Refused before the code is looked at: it is no wrong code - the other budget gets its failure back.
        if (byAccount.allowed) await giveBack(accountBucket, account);
        if (byClient.allowed) await giveBack(B.signInCodeCheckClient, clientKey);
        const limit = byAccount.allowed ? B.signInCodeCheckClient : accountBucket;
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
      // All clients together: a refused client or address counts nowhere else (it cannot fill this budget).
      const all = await failClosed(deps, action, () =>
        deps.store.hit(
          B.signInCodeCheckAllClients,
          ALL_CLIENTS_SUBJECT,
          limits.checkWrongAllClients,
        ),
      );
      if (!all.allowed) {
        await giveBack(accountBucket, account);
        await giveBack(B.signInCodeCheckClient, clientKey);
        // The alert line of the ceiling: no code, no address, no client reference - it belongs to nobody.
        deps.log({
          event: 'auth.sign_in_codes.global_limit',
          action,
          reason: B.signInCodeCheckAllClients,
          limit: B.signInCodeCheckAllClients,
          retryAfterS: all.retryAfterSeconds,
        });
        return { allowed: false, retryAfterSeconds: all.retryAfterSeconds };
      }
      const attempt: SignInCodeAttempt = {
        triesIfWrong: byAccount.remaining,
        failed() {
          deps.log({ event: 'auth.sign_in_code.failed', action, reason: 'invalid_code', ...refs });
          for (const [bucket, counter] of [
            [accountBucket, byAccount],
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
          if (all.remaining === 0) {
            // The ceiling trips with this wrong code: the alert does not wait for the next visitor.
            deps.log({
              event: 'auth.sign_in_codes.global_limit',
              action,
              reason: B.signInCodeCheckAllClients,
              limit: B.signInCodeCheckAllClients,
              retryAfterS: all.retryAfterSeconds,
            });
          }
          return Promise.resolve();
        },
        async succeeded() {
          try {
            await deps.store.clear(accountBucket, account);
          } catch (error) {
            deps.log({
              event: 'auth.limiter.unavailable',
              action,
              reason: 'success_not_recorded',
              errorName: errorNameOf(error),
            });
          }
          await giveBack(B.signInCodeCheckClient, clientKey);
          await giveBack(B.signInCodeCheckAllClients, ALL_CLIENTS_SUBJECT);
        },
        async released() {
          await giveBack(accountBucket, account);
          await giveBack(B.signInCodeCheckClient, clientKey);
          await giveBack(B.signInCodeCheckAllClients, ALL_CLIENTS_SUBJECT);
        },
      };
      return { allowed: true, attempt };
    },
  };
}
