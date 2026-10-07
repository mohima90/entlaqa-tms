'use server';
/**
 * Accepting an invitation (FR-IAM-03, T-M2-07; docs/engineering/invitations-contract.md §1 step 5).
 * Public actions (no organization yet): the invitee has only the e-mailed link. The flow and its checks
 * are in @jadarat/platform-identity (invitation-accept.ts); these actions only validate input. A new
 * account signs up through the public Auth API, gated by Auth's before-user-created hook: the web app
 * holds no Auth secret key (ADR 0002 §7 implementation note T-M2-07, security review H1).
 */
import { ok } from '@jadarat/platform-core';
import {
  acceptInvitationAsSignedInUserForRequest,
  acceptInvitationWithNewAccountForRequest,
  acceptInvitationWithPasswordForRequest,
  lookupInvitationLinkForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import {
  AcceptAsSignedInInput,
  AcceptInvitationInput,
  LookupInvitationInput,
  SignInToAcceptInput,
} from '../lib/invite-accept-input';

/**
 * What a link is (screens 8 and 9): the page reads the token from the URL fragment in the browser —
 * never sent with a page request, so never in access logs or Referer headers (review M3) — and asks
 * here. The answer is the link state; for a valid link also what screen 8 shows and whether the
 * visitor is signed in as the invited account, another account, or not at all. Never ids.
 */
export const lookupInvitationAction = definePublicAction({
  name: 'platform.invitation.lookup',
  input: LookupInvitationInput,
  handler: async ({ input }) => ok(await lookupInvitationLinkForRequest(input.token)),
});

/** New account: set the password (and display names), then land signed in. */
export const acceptInvitationAction = definePublicAction({
  name: 'platform.invitation.accept',
  input: AcceptInvitationInput,
  handler: ({ input }) =>
    acceptInvitationWithNewAccountForRequest({
      token: input.token,
      password: input.password,
      displayNameAr: input.displayNameAr,
      displayNameEn: input.displayNameEn,
    }),
});

/** "Sign in to accept": the invitation e-mail already has an account (contract §1 step 5). */
export const acceptInvitationWithSignInAction = definePublicAction({
  name: 'platform.invitation.accept_with_sign_in',
  input: SignInToAcceptInput,
  handler: ({ input }) => acceptInvitationWithPasswordForRequest(input),
});

/** Already signed in with the invited account: accept with the current session. */
export const acceptInvitationAsSignedInUser = definePublicAction({
  name: 'platform.invitation.accept_as_signed_in',
  input: AcceptAsSignedInInput,
  handler: ({ input }) => acceptInvitationAsSignedInUserForRequest(input),
});
