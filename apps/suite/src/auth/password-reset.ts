'use server';
/**
 * Forgot / reset password (FR-IAM-13, NFR-SEC-01; T-M2-08, screens 10 and 11). Public actions: the
 * visitor has no session (screen 10) or only the e-mailed link (screen 11). The flow, its checks and
 * the application rate limits (the shared PostgreSQL limiter, T-M2-11 — per client and per account) are
 * in @jadarat/platform-identity (password-reset.ts, auth-limits.ts); these actions validate input and pass
 * the request's client (lib/request-client.ts). Supabase Auth's own recovery on a stateless client
 * (publishable key): the web app holds no Auth secret key (ADR 0002 §7).
 */
import { ok } from '@jadarat/platform-core';
import {
  completePasswordResetForRequest,
  requestPasswordResetForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { CompletePasswordResetInput, RequestPasswordResetInput } from '../lib/password-reset-input';
import { requestClient } from '../lib/request-client';

/**
 * Screen 10: always the same answer — "if an account exists for this address, a link valid for 60
 * minutes is on its way" — after the same time, whether or not the address has an account, the request
 * was limited, or Auth limited or failed it (no account enumeration). The address is never logged.
 */
export const requestPasswordResetAction = definePublicAction({
  name: 'platform.auth.request_password_reset',
  input: RequestPasswordResetInput,
  handler: async ({ input }) => {
    // The limiter runs in the background with the delivery: a limited request looks the same.
    await requestPasswordResetForRequest({ email: input.email }, await requestClient());
    return ok({ requested: true as const });
  },
});

/**
 * Screen 11: the link's token (read from the URL fragment in the browser) and the new password, whose
 * rules are checked here before the single-use link is spent — with the authenticator app's code for an
 * account that uses one (Auth sets the password only after it, T-M2-10). Limited per client before the
 * link is used (RATE_LIMITED; the generic internal error when the limiter cannot answer — the link stays
 * usable). On success every session of the account has ended, its sign-in lock too, and the visitor signs
 * in with the new password; this browser is trusted for 30 days with «تذكّر هذا المتصفح» ticked,
 * otherwise for 24 hours (T-M2-11).
 */
export const completePasswordResetAction = definePublicAction({
  name: 'platform.auth.password_reset',
  input: CompletePasswordResetInput,
  handler: async ({ input }) =>
    completePasswordResetForRequest(
      {
        tokenHash: input.tokenHash,
        password: input.password,
        code: input.code,
        remember: input.remember,
      },
      await requestClient(),
    ),
});
