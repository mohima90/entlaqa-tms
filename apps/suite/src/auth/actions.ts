'use server';
/**
 * Unauthenticated / pre-tenant server actions (ADR 0003 §2, T-M1-D03). The ONLY place where
 * definePublicAction() is allowed (CI gate, scripts/lib/server-actions.mjs): every entry point that
 * runs before the caller has an organization lives here. The flow logic and its checks are in
 * @jadarat/platform-identity (auth-flow.ts); these actions only validate input.
 */
import {
  completeRememberedSignInForRequest,
  requestSignInCodeForRequest,
  selectOrganizationForRequest,
  signInWithPasswordForRequest,
  signOutEndedSessionForRequest,
  signInWithEmailedCodeForRequest,
  signOutForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';
import { requestClient } from '../lib/request-client';

/**
 * Limited per account and per client on the shared limiter before Auth is asked (T-M2-11): a limited
 * attempt gets one generic answer (AUTH_TOO_MANY_ATTEMPTS), the same for unknown accounts; when the
 * limiter cannot answer, sign-in fails closed (the generic internal error). `remember` («تذكّر هذا
 * المتصفح», unticked by default — PO decision 9 Oct 2026): only a successful sign-in with it ticked trusts
 * this browser for 30 days.
 */
export const signInAction = definePublicAction({
  name: 'platform.auth.sign_in',
  input: z.object({
    email: z.email().max(254),
    // Length bound only: the password policy is enforced by Supabase Auth when passwords are set.
    password: z.string().min(1).max(1024),
    remember: z.boolean().default(false),
  }),
  handler: async ({ input }) => signInWithPasswordForRequest(input, await requestClient()),
});

/**
 * «Email me a code instead» (WP-ADM-05, PO 23 Oct 2026): a second way to sign in, offered to everybody on the
 * password step. Limited per client and per address before anything is queued; the answer is the same for every
 * address (no account enumeration). `forceCode`: send a code even if this browser is remembered (the fallback
 * when the remembered sign-in could not finish).
 */
export const requestSignInCodeAction = definePublicAction({
  name: 'platform.auth.sign_in_code_request',
  input: z.strictObject({ email: z.email().max(254), forceCode: z.boolean().default(false) }),
  handler: async ({ input }) =>
    requestSignInCodeForRequest(
      { email: input.email, forceCode: input.forceCode },
      await requestClient(),
    ),
});

/**
 * The six digits (and «Remember this browser»): opens the session like a password sign-in would. Wrong codes
 * are counted per address and per client (5 pause code checks for 15 minutes); the code itself dies after 5
 * tries, 10 minutes or its first use.
 */
export const signInWithCodeAction = definePublicAction({
  name: 'platform.auth.sign_in_code_verify',
  input: z.strictObject({
    requestId: z.uuid(),
    email: z.email().max(254),
    code: z.string().regex(/^[0-9]{6}$/),
    remember: z.boolean().default(false),
  }),
  handler: async ({ input }) => signInWithEmailedCodeForRequest(input, await requestClient()),
});

/** A remembered browser: finishes the sign-in that needs no code (waits a few seconds for the worker). */
export const completeRememberedSignInAction = definePublicAction({
  name: 'platform.auth.sign_in_remembered',
  input: z.strictObject({ requestId: z.uuid(), email: z.email().max(254) }),
  handler: async ({ input }) => completeRememberedSignInForRequest(input, await requestClient()),
});

export const selectOrganizationAction = definePublicAction({
  name: 'platform.auth.select_organization',
  input: z.object({ tenantId: z.uuid() }),
  handler: ({ input }) => selectOrganizationForRequest(input.tenantId),
});

export const signOutAction = definePublicAction({
  name: 'platform.auth.sign_out',
  input: z.object({}).strict(),
  handler: () => signOutForRequest(),
});

/**
 * The sign-in page signs out a session its organization's rules ended (T-M2-10): Auth deletes it with the
 * session's own token and the cookies are cleared. Any other session is left alone.
 */
export const signOutEndedSessionAction = definePublicAction({
  name: 'platform.auth.session_ended',
  input: z.object({}).strict(),
  handler: () => signOutEndedSessionForRequest(),
});
