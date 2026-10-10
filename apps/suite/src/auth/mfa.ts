'use server';
/**
 * Authenticator app (FR-IAM-12, T-M2-10): set up, code at sign-in or before a sensitive action, remove,
 * "not now" on the Organization Admin prompt (PO decision 2), "send the confirmation e-mail again", and the
 * set-up e-mail's links (review H1). Public actions (ADR 0003 §4.7): a session the organization's MFA
 * policy refuses has no access to the organization until a code passed, so these cannot be tenant actions,
 * and the e-mail links work without a session. Each flow verifies the caller's own session with Auth
 * (platform-identity mfa.ts) and acts on that account only; the database applies the organization's policy.
 *
 * INTEGRATION POINT (T-M2-11, review M3): per-account attempt limits wrap verifyTotpCodeAction's handler;
 * refused codes are logged as `platform.auth.mfa_verify` / MFA_CODE_INVALID.
 */
import { ok } from '@jadarat/platform-core';
import {
  dismissMfaPromptForRequest,
  openMfaLinkForRequest,
  removeTotpForRequest,
  requestMfaConfirmationMailForRequest,
  startTotpSetupForRequest,
  verifyTotpCodeForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';
import { TotpCode } from '../lib/totp-code';

export const startTotpSetupAction = definePublicAction({
  name: 'platform.auth.mfa_setup',
  input: z.strictObject({}),
  handler: () => startTotpSetupForRequest(),
});

export const verifyTotpCodeAction = definePublicAction({
  name: 'platform.auth.mfa_verify',
  input: z.strictObject({ code: TotpCode, factorId: z.uuid().optional() }),
  handler: ({ input }) => verifyTotpCodeForRequest(input),
});

export const removeTotpAction = definePublicAction({
  name: 'platform.auth.mfa_remove',
  input: z.strictObject({}),
  handler: () => removeTotpForRequest(),
});

/** "Send the e-mail again" for an app waiting for its confirmation (review H1). */
export const requestMfaConfirmationMailAction = definePublicAction({
  name: 'platform.auth.mfa_confirmation_mail',
  input: z.strictObject({}),
  handler: () => requestMfaConfirmationMailForRequest(),
});

/**
 * The set-up e-mail's links (review H1), opened with a click on their page: "confirm" makes the app count;
 * "remove" ("not you?") removes it and ends every session of the account. The token comes from the URL
 * fragment; only its SHA-256 reaches the database.
 */
export const openMfaLinkAction = definePublicAction({
  name: 'platform.auth.mfa_link',
  input: z.strictObject({
    kind: z.enum(['confirm', 'remove']),
    token: z.string().max(128),
  }),
  handler: async ({ input }) =>
    ok({ outcome: await openMfaLinkForRequest(input.kind, input.token) }),
});

export const dismissMfaPromptAction = definePublicAction({
  name: 'platform.auth.mfa_prompt_dismiss',
  input: z.strictObject({}),
  handler: async () => ok(await dismissMfaPromptForRequest()),
});
