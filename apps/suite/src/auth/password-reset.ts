'use server';
/**
 * Forgot / reset password (FR-IAM-13, NFR-SEC-01; T-M2-08, screens 10 and 11). Public actions: the
 * visitor has no session (screen 10) or only the e-mailed link (screen 11). The flow and its checks
 * are in @jadarat/platform-identity (password-reset.ts); these actions validate input and apply the
 * application rate limits (lib/reset-limits.ts). Supabase Auth's own recovery on a stateless client
 * (publishable key): the web app holds no Auth secret key (ADR 0002 §7).
 */
import { appError, err, ok } from '@jadarat/platform-core';
import {
  completePasswordResetForRequest,
  requestPasswordResetForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { headers } from 'next/headers';
import { clientAddress } from '../lib/client-ip';
import { CompletePasswordResetInput, RequestPasswordResetInput } from '../lib/password-reset-input';
import { resetLimiter } from '../lib/reset-limits';

async function requestClient(): Promise<string> {
  const store = await headers();
  return clientAddress((name) => store.get(name));
}

/**
 * Screen 10: always the same answer — "if an account exists for this address, a link valid for 60
 * minutes is on its way" — after the same time, whether or not the address has an account, the request
 * was limited, or Auth limited or failed it (no account enumeration). The address is never logged.
 */
export const requestPasswordResetAction = definePublicAction({
  name: 'platform.auth.request_password_reset',
  input: RequestPasswordResetInput,
  handler: async ({ input }) => {
    const limited = !resetLimiter.allowRequest(input.email, await requestClient());
    await requestPasswordResetForRequest({ email: input.email, limited });
    return ok({ requested: true as const });
  },
});

/**
 * Screen 11: the link's token (read from the URL fragment in the browser) and the new password, whose
 * rules are checked here before the single-use link is spent. On success every session of the account
 * has ended and the visitor signs in with the new password.
 */
export const completePasswordResetAction = definePublicAction({
  name: 'platform.auth.password_reset',
  input: CompletePasswordResetInput,
  handler: async ({ input }) => {
    if (!resetLimiter.allowCompletion(await requestClient())) return err(appError('RATE_LIMITED'));
    return completePasswordResetForRequest({
      tokenHash: input.tokenHash,
      password: input.password,
    });
  },
});
