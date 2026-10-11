'use server';
/**
 * Authenticator app (FR-IAM-12, T-M2-10): set up, code at sign-in or before a sensitive action, the
 * e-mailed set-up code and "send the e-mail again" (in the window that set the app up — re-review N1),
 * remove an app (a confirmed one, this window's set-up, or one added from another sign-in), "not now" on the
 * Organization Admin prompt (PO decision 2), and the set-up e-mail's "not you? remove this app" link (review
 * H1). Public actions (ADR 0003 §4.7): a session the organization's MFA policy refuses has no access to the
 * organization until a code passed, so these cannot be tenant actions, and the e-mail link works without a
 * session. Each flow verifies the caller's own session with Auth (platform-identity mfa.ts) and acts on that
 * account only; the database applies the organization's policy and decides who may confirm or remove what.
 *
 * Attempt limits (T-M2-11, review M3; TM-0003 T-IAM-12): the authenticator code and the e-mailed set-up
 * code are limited per account and per client on the shared limiter (5 wrong codes per account,
 * consecutive, 100 per client per 15 minutes; RATE_LIMITED when used up; the generic internal error when
 * the limiter cannot answer), so these actions pass the request's client (lib/request-client.ts). Refused
 * codes are logged as `platform.auth.mfa_verify` / MFA_CODE_INVALID and `platform.auth.mfa_confirm`.
 */
import { ok } from '@jadarat/platform-core';
import {
  confirmMfaSetupForRequest,
  dismissMfaPromptForRequest,
  openMfaRemoveLinkForRequest,
  removeMfaAppForRequest,
  resendMfaSetupMailForRequest,
  startTotpSetupForRequest,
  verifyTotpCodeForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';
import { requestClient } from '../lib/request-client';
import { EmailSetupCode, TotpCode } from '../lib/totp-code';

export const startTotpSetupAction = definePublicAction({
  name: 'platform.auth.mfa_setup',
  input: z.strictObject({}),
  handler: () => startTotpSetupForRequest(),
});

export const verifyTotpCodeAction = definePublicAction({
  name: 'platform.auth.mfa_verify',
  input: z.strictObject({ code: TotpCode, factorId: z.uuid().optional() }),
  handler: async ({ input }) => verifyTotpCodeForRequest(input, await requestClient()),
});

/** The e-mailed code of a new app, in the window that set it up (re-review N1). */
export const confirmMfaSetupAction = definePublicAction({
  name: 'platform.auth.mfa_confirm',
  input: z.strictObject({ code: EmailSetupCode }),
  handler: async ({ input }) => confirmMfaSetupForRequest(input, await requestClient()),
});

/** "Send the e-mail again" from the window that set the app up (re-review N1). */
export const resendMfaSetupMailAction = definePublicAction({
  name: 'platform.auth.mfa_setup_mail',
  input: z.strictObject({}),
  handler: () => resendMfaSetupMailForRequest(),
});

/**
 * Removes one of the account's apps (re-review N1): a confirmed one (a recent code first), this window's
 * own set-up, or an app added from another sign-in (the account's other sessions end).
 */
export const removeMfaAppAction = definePublicAction({
  name: 'platform.auth.mfa_remove',
  input: z.strictObject({ factorId: z.uuid() }),
  handler: ({ input }) => removeMfaAppForRequest(input),
});

/**
 * The set-up e-mail's "not you? remove this app" link (review H1), opened with a click on its page: removes
 * that app and ends every session of the account. The token comes from the URL fragment; only its SHA-256
 * reaches the database.
 */
export const openMfaRemoveLinkAction = definePublicAction({
  name: 'platform.auth.mfa_link',
  input: z.strictObject({ token: z.string().max(128) }),
  handler: async ({ input }) => ok({ outcome: await openMfaRemoveLinkForRequest(input.token) }),
});

export const dismissMfaPromptAction = definePublicAction({
  name: 'platform.auth.mfa_prompt_dismiss',
  input: z.strictObject({}),
  handler: async () => ok(await dismissMfaPromptForRequest()),
});
