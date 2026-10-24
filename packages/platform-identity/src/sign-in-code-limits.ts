import 'server-only';
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
  userSubject,
  webhookSubject,
} from './auth-limits';

/**
 * «Email me a code» on the shared limiter (WP-ADM-05, PO 23 Oct 2026; docs/engineering/sign-in-protection.md
 * §12). The code itself is Auth's e-mail OTP, so these limits run in OUR database before Auth is asked or
 * answered. Requests are limited per client (an IPv6 client by its /48), then per typed address - one a minute,
 * 10 in 15 minutes and 40 a day - the same for known and unknown addresses; checks count wrong codes only, per
 * typed address - whether or not it has an account, so the counts tell nothing - per client and for all
 * clients together; the 5th wrong code in the window pauses code checks for the rest of it (15 minutes, longer
 * than the code lives, so a paused address has no live code to guess). The address's budget follows the
 * organization's lock-out policy where it applies. Fails closed (RateLimiterUnavailableError, the generic
 * internal error). Keys are hashed subjects, never readable.
 */

/** One check of a sign-in code that reached Auth. No method throws. */
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
   * No code was compared (Auth could not answer, was rate limiting): the provisional failures are given back.
   */
  released(): Promise<void>;
}

/** The verdict of a request: allowed, or refused - `tooSoonSeconds` when it is the one-a-minute rule. */
export type SignInCodeRequestVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly tooSoonSeconds?: number };

export interface SignInCodeLimiter {
  /** Per client first, then - only for an allowed client - per typed address. Throws when the limiter fails. */
  readonly allowRequest: (email: string) => Promise<SignInCodeRequestVerdict>;
  /** Before a code is looked at: counts a provisional wrong code; refused when a budget is used up. */
  readonly checkCode: (email: string) => Promise<LimitGate<SignInCodeAttempt>>;
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
    async allowRequest(email) {
      const action = deps.requestAction;
      return failClosed(deps, action, async (): Promise<SignInCodeRequestVerdict> => {
        const fromClient = await deps.store.hit(
          B.signInCodeRequestClient,
          clientKey,
          shared ? limits.sharedClientRequests : limits.requestsPerClient,
        );
        const refused = (limit: string, counter: RateLimitCounter): SignInCodeRequestVerdict => {
          deps.log({
            event: 'auth.rate_limited',
            action,
            reason: limit,
            limit,
            retryAfterS: counter.retryAfterSeconds,
            clientRef: fromClient.ref,
          });
          return { allowed: false };
        };
        // A refused client counts nowhere else: it cannot use up (or fill up) other addresses' budgets.
        if (!fromClient.allowed) return refused(B.signInCodeRequestClient, fromClient);
        const account = accountSubject(email);
        // One code a minute per address: the same wait for a known and an unknown address.
        const minute = await deps.store.hit(
          B.signInCodeRequestMinute,
          account,
          limits.requestsPerMinute,
        );
        if (!minute.allowed) {
          return { allowed: false, tooSoonSeconds: minute.retryAfterSeconds };
        }
        const recent = await deps.store.hit(
          B.signInCodeRequestAccount,
          account,
          limits.requestsPerAccount,
        );
        if (!recent.allowed) return refused(B.signInCodeRequestAccount, recent);
        const daily = await deps.store.hit(
          B.signInCodeRequestAccountDaily,
          account,
          limits.requestsPerAccountDaily,
        );
        return daily.allowed ? { allowed: true } : refused(B.signInCodeRequestAccountDaily, daily);
      });
    },
    async checkCode(email) {
      const action = deps.checkAction;
      // The address's own budget (the organization's lock-out policy where it applies).
      const budgetOf = deps.accountBudget;
      const accountLimit = budgetOf
        ? await failClosed(deps, action, () => budgetOf(email))
        : limits.checkAccountFailures;
      const account = accountSubject(email);
      const clientFailures = shared ? limits.sharedClientCheckFailures : limits.checkClientFailures;
      const [byAccount, byClient] = await failClosed(deps, action, () =>
        Promise.all([
          deps.store.hit(B.signInCodeCheckAccount, account, accountLimit),
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
      // All clients together: a refused client or address counts nowhere else (it cannot fill this budget).
      const all = await failClosed(deps, action, () =>
        deps.store.hit(
          B.signInCodeCheckAllClients,
          ALL_CLIENTS_SUBJECT,
          limits.checkWrongAllClients,
        ),
      );
      if (!all.allowed) {
        await giveBack(B.signInCodeCheckAccount, account);
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
          await giveBack(B.signInCodeCheckAllClients, ALL_CLIENTS_SUBJECT);
        },
        async released() {
          await giveBack(B.signInCodeCheckAccount, account);
          await giveBack(B.signInCodeCheckClient, clientKey);
          await giveBack(B.signInCodeCheckAllClients, ALL_CLIENTS_SUBJECT);
        },
      };
      return { allowed: true, attempt };
    },
  };
}

/**
 * The Send Email hook's own limits (security re-review M-A and L1). The request limits above run in the app's
 * server action, but Auth's public /otp endpoint can be called by anyone without passing them - and each call
 * makes Auth call the hook, which e-mails a code. So the hook counts, per ACCOUNT (the user id Auth sends, not
 * a typed address): 10 codes in 15 minutes and 40 a day; over the limit nothing is e-mailed and the skip is
 * logged. And it never acts twice on the same webhook id within five minutes (the signed timestamp's own
 * tolerance): a captured signed call cannot be replayed. Fail closed like the others.
 */
export interface SendEmailHookLimiter {
  /**
   * First sight of this webhook id in the last five minutes? false: a replay - do nothing. Throws when the
   * limiter fails (the hook then sends nothing).
   */
  claimWebhook(webhookId: string): Promise<boolean>;
  /** Gives the webhook id back (the call failed, so a retry of it must be handled). Never throws. */
  releaseWebhook(webhookId: string): Promise<void>;
  /** May another code be e-mailed to this account now? Counts it. Throws when the limiter fails. */
  allowSend(userId: string): Promise<boolean>;
}

export function createSendEmailHookLimiter(
  deps: LimiterDeps & { readonly action: string },
): SendEmailHookLimiter {
  const limits = deps.limits.signInCode;
  const B = LIMIT_BUCKETS;
  return {
    claimWebhook(webhookId) {
      return failClosed(deps, deps.action, async () => {
        const hit = await deps.store.hit(
          B.signInCodeHookReplay,
          webhookSubject(webhookId),
          limits.hookReplay,
        );
        if (!hit.allowed) {
          deps.log({
            event: 'auth.rate_limited',
            action: deps.action,
            reason: B.signInCodeHookReplay,
            limit: B.signInCodeHookReplay,
            retryAfterS: hit.retryAfterSeconds,
          });
        }
        return hit.allowed;
      });
    },
    async releaseWebhook(webhookId) {
      try {
        await deps.store.giveBack(B.signInCodeHookReplay, webhookSubject(webhookId));
      } catch (error) {
        deps.log({
          event: 'auth.limiter.unavailable',
          action: deps.action,
          reason: 'webhook_not_given_back',
          errorName: errorNameOf(error),
        });
      }
    },
    allowSend(userId) {
      return failClosed(deps, deps.action, async () => {
        const account = userSubject(userId);
        const recent = await deps.store.hit(
          B.signInCodeHookSend,
          account,
          limits.hookSendsPerAccount,
        );
        if (!recent.allowed) {
          deps.log({
            event: 'auth.rate_limited',
            action: deps.action,
            reason: B.signInCodeHookSend,
            limit: B.signInCodeHookSend,
            retryAfterS: recent.retryAfterSeconds,
            subjectRef: recent.ref,
          });
          return false;
        }
        const daily = await deps.store.hit(
          B.signInCodeHookSendDaily,
          account,
          limits.hookSendsPerAccountDaily,
        );
        if (!daily.allowed) {
          deps.log({
            event: 'auth.rate_limited',
            action: deps.action,
            reason: B.signInCodeHookSendDaily,
            limit: B.signInCodeHookSendDaily,
            retryAfterS: daily.retryAfterSeconds,
            subjectRef: daily.ref,
          });
          return false;
        }
        return true;
      });
    },
  };
}
