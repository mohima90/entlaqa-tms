import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import type { TokenLookup, UserTx } from '@jadarat/platform-db';
import {
  type AuthFlowDeps,
  AuthServiceError,
  type SessionTokens,
  selectOrganization,
  sessionTokens,
  startPasswordSession,
} from './auth-flow';
import { verifyClaims, verifyClaimsStrict } from './verify-claims';

/**
 * Accepting an invitation (FR-IAM-03, T-M2-07; docs/engineering/invitations-contract.md §1 steps 4–5).
 * Framework-free like auth-flow.ts; the Next.js adapter is auth-next.ts and the public actions are in
 * apps/suite/src/auth/invitations.ts.
 *
 *   open link  → token format check → SHA-256 → invitation_by_token → valid | expired | revoked | used | invalid
 *   new account → (valid) public Auth sign-up as the invitation e-mail with the RAW token in the user
 *                 metadata — Auth's before-user-created hook admits only a valid invitation for that
 *                 e-mail (ADR 0002 §7 note T-M2-07; no Auth secret key in the web app) → the token is
 *                 removed from the metadata → accept_invitation_as_caller(hash, display names) with the
 *                 new session → the organization is selected
 *   existing account ("sign in to accept") → password sign-in as the invitation e-mail, or the current
 *                 session → accept_invitation_as_caller(hash) in withUserTx → select the organization
 *
 * The raw token is never logged or returned; besides the sign-up metadata (removed again right after the
 * sign-up) only its hash reaches the database. Answers never say more about accounts than the contract
 * allows: only "an account with this e-mail exists" (the invitee already received the e-mail, so the
 * address is theirs).
 */
export const InvitationErrors = defineErrorCodes({
  /** Expired, revoked, already used or unknown — the page then shows the link state (screen 9). */
  INVITATION_NOT_VALID: { status: 409, messageKey: 'invite.errors.notValid' },
  /** The invitation e-mail already has an account: sign in to accept (contract §1 step 5). */
  INVITATION_ACCOUNT_EXISTS: { status: 409, messageKey: 'invite.errors.accountExists' },
  /** Auth refused the new password (its own policy, e.g. a leaked password). */
  INVITATION_PASSWORD_REJECTED: { status: 422, messageKey: 'invite.errors.passwordRejected' },
  /** Signed in as an account whose e-mail is not the invitation's. */
  INVITATION_OTHER_ACCOUNT: { status: 403, messageKey: 'invite.errors.otherAccount' },
  /** "Sign in to accept": the account already is a member of the organization. */
  INVITATION_ALREADY_MEMBER: { status: 409, messageKey: 'invite.errors.alreadyMember' },
  /** "Sign in to accept": the database refused the account for this invitation (other Auth e-mail). */
  INVITATION_ACCOUNT_MISMATCH: { status: 403, messageKey: 'invite.errors.accountMismatch' },
  /** Shorter than the organization's minimum (T-M2-10; `min` in params). Checked before Auth. */
  INVITATION_PASSWORD_TOO_SHORT: { status: 422, messageKey: 'invite.errors.passwordTooShort' },
});

/** The code track A's helpers throw when the invitation is no longer valid (contract §2). */
export const INVITATION_NOT_VALID_CODE = 'INVITATION_NOT_VALID';

/** A token as e-mailed: 32 random bytes, base64url without padding (contract §1 step 2). */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface InvitationAcceptOutcome {
  /**
   * Where to go: suite home, the organization chooser, sign-in (account ready, sign-in failed), or the
   * MFA page when the organization asks for an authenticator app (screen 8 step 2, T-M2-10).
   */
  readonly next: 'home' | 'choose-organization' | 'sign-in' | 'mfa';
}

/**
 * The public Auth methods of the new-account path (the same cookie-bound server client as sign-in;
 * publishable key only). Structural: supabase-js is only imported by platform-db.
 */
export interface InvitationSignUpClientLike {
  readonly auth: {
    signUp(credentials: {
      email: string;
      password: string;
      options: { data: { invitation: string } };
    }): Promise<{
      data: unknown;
      error: { status?: number | undefined; code?: string | undefined } | null;
    }>;
    /** `invitation: null` removes the key from the user metadata (Auth deletes null keys). */
    updateUser(attributes: { data: { invitation: null } }): Promise<{ error: unknown }>;
  };
}

export interface InvitationAcceptDeps {
  readonly auth: AuthFlowDeps;
  /** The same client as `auth.supabase`, seen through the sign-up methods; null when not configured. */
  readonly signUpClient: InvitationSignUpClientLike | null;
  readonly hashToken: (token: string) => Buffer;
  readonly invitationByToken: (tokenHash: Buffer) => Promise<TokenLookup>;
  /** The organization's minimum password length for a new account (T-M2-10; at least 12). */
  readonly invitationPasswordMinLength: (tokenHash: Buffer) => Promise<number>;
  readonly acceptInvitationAsCaller: (
    tx: UserTx,
    tokenHash: Buffer,
    displayName?: { readonly ar?: string | null; readonly en?: string | null },
  ) => Promise<{ tenantId: string }>;
}

/** Thrown (→ INTERNAL_ERROR with a correlation id) when Auth refused the sign-up unexpectedly. */
export class InvitationAccountError extends Error {
  override readonly name = 'InvitationAccountError';
  constructor() {
    super('the Auth user of the invitation could not be created');
  }
}

const ACCEPT_ACTION = 'platform.invitation.accept';

function errorCodeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** The refusals of accept_invitation_as_caller the invitee can act on (platform-db DomainError codes). */
function callerRefusal(error: unknown): AppError | null {
  switch (errorCodeOf(error)) {
    case INVITATION_NOT_VALID_CODE:
      return appError(InvitationErrors.INVITATION_NOT_VALID);
    case 'ALREADY_MEMBER':
      return appError(InvitationErrors.INVITATION_ALREADY_MEMBER);
    case 'INVITATION_ACCOUNT_MISMATCH':
      return appError(InvitationErrors.INVITATION_ACCOUNT_MISMATCH);
    default:
      return null;
  }
}

function notValid(): Result<never, AppError> {
  return err(appError(InvitationErrors.INVITATION_NOT_VALID));
}

type ValidLookup = Extract<TokenLookup, { state: 'valid' }>;
type LookupDeps = Pick<InvitationAcceptDeps, 'hashToken' | 'invitationByToken'>;

async function lookupWithHash(
  deps: LookupDeps,
  token: string,
): Promise<{ readonly lookup: TokenLookup; readonly tokenHash: Buffer | null }> {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    return { lookup: { state: 'invalid' }, tokenHash: null };
  }
  const tokenHash = deps.hashToken(token);
  return { lookup: await deps.invitationByToken(tokenHash), tokenHash };
}

/** The link state for the accept page. A malformed token never reaches the database. */
export async function lookupInvitation(deps: LookupDeps, token: string): Promise<TokenLookup> {
  return (await lookupWithHash(deps, token)).lookup;
}

/** Who is looking at a valid link: nobody signed in, the invited account, or another account. */
export type InvitationViewer = 'anonymous' | 'invitee' | 'other-account';

/** What the accept page shows for a link (screens 8 and 9): the state, and for a valid link its details. */
export type InvitationLinkView =
  | Exclude<TokenLookup, { state: 'valid' }>
  | (ValidLookup & {
      readonly viewer: InvitationViewer;
      /** The organization's minimum password length, for the live rules (T-M2-10). */
      readonly passwordMinLength: number;
    });

/** Password length as people count it: characters (code points), not UTF-16 units. */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

/**
 * The accept page's view of a link (review M3: the page reads the token from the URL fragment in the
 * browser and asks through a public action). The viewer is derived from the verified session here, so
 * the page never needs the session's e-mail.
 */
export async function lookupInvitationLink(
  deps: LookupDeps &
    Pick<InvitationAcceptDeps, 'invitationPasswordMinLength'> & {
      readonly auth: Pick<AuthFlowDeps, 'supabase'>;
    },
  token: string,
): Promise<InvitationLinkView> {
  const { lookup, tokenHash } = await lookupWithHash(deps, token);
  if (lookup.state !== 'valid') return { state: lookup.state };
  if (!tokenHash) return { state: 'invalid' };
  const claims = await verifyClaims(deps.auth.supabase);
  const viewer: InvitationViewer = !claims.ok
    ? 'anonymous'
    : sessionEmail(claims.value) === lookup.email.toLowerCase()
      ? 'invitee'
      : 'other-account';
  return {
    ...lookup,
    viewer,
    passwordMinLength: await deps.invitationPasswordMinLength(tokenHash),
  };
}

/** The invitation and its token hash when (and only when) the link is valid. */
async function validInvitation(
  deps: LookupDeps,
  token: string,
): Promise<{ readonly invitation: ValidLookup; readonly tokenHash: Buffer } | null> {
  const { lookup, tokenHash } = await lookupWithHash(deps, token);
  return lookup.state === 'valid' && tokenHash ? { invitation: lookup, tokenHash } : null;
}

/** The e-mail claim of a verified session, if any (Supabase access tokens carry it). */
export function sessionEmail(claims: VerifiedClaims): string | null {
  const email = (claims as Record<string, unknown>).email;
  return typeof email === 'string' && email.length > 0 ? email.toLowerCase() : null;
}

/** The link's state now, for an operational log line ('unknown' when it cannot be read). */
async function currentState(deps: LookupDeps, tokenHash: Buffer): Promise<string> {
  try {
    return (await deps.invitationByToken(tokenHash)).state;
  } catch {
    return 'unknown';
  }
}

function cleanName(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Auth's answer to a refused sign-up. 403 is the before-user-created hook (no valid invitation for this
 * e-mail and token — whatever changed since the lookup); an existing account takes the "sign in to
 * accept" path. Auth unreachable or failing → AuthServiceError; anything else (e.g. sign-ups disabled,
 * a misconfiguration) → InvitationAccountError, logged without personal data.
 */
function signUpRefusal(
  deps: InvitationAcceptDeps,
  error: { readonly status?: number | undefined; readonly code?: string | undefined },
): Result<never, AppError> {
  const { status, code } = error;
  if (status === 403) return notValid();
  if (code === 'user_already_exists' || code === 'email_exists') {
    return err(appError(InvitationErrors.INVITATION_ACCOUNT_EXISTS));
  }
  if (code === 'weak_password') return err(appError(InvitationErrors.INVITATION_PASSWORD_REJECTED));
  if (status === 429 || code === 'over_request_rate_limit') return err(appError('RATE_LIMITED'));
  if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
  deps.auth.logWarning('invitation: Auth refused the sign-up', {
    action: ACCEPT_ACTION,
    status,
    ...(code === undefined ? {} : { errorCode: code }),
  });
  throw new InvitationAccountError();
}

/**
 * Removes the raw token from the new account's user metadata (Auth copied it there, into the identity
 * and into the session's access token). Best effort: a failure is logged and the acceptance goes on —
 * the token is single use and becomes worthless once accepted.
 */
async function clearInvitationMetadata(
  deps: InvitationAcceptDeps,
  client: InvitationSignUpClientLike,
): Promise<void> {
  let failed: boolean;
  try {
    failed = Boolean((await client.auth.updateUser({ data: { invitation: null } })).error);
  } catch {
    failed = true;
  }
  if (failed) {
    deps.auth.logWarning('invitation: could not remove the token from the new account metadata', {
      action: ACCEPT_ACTION,
    });
  }
}

/**
 * Contract §1 step 5, new account: sign up through the public Auth API (gated by the before-user-created
 * hook), accept as the new user with that session, open the organization.
 */
export async function acceptInvitationWithNewAccount(
  deps: InvitationAcceptDeps,
  input: {
    readonly token: string;
    readonly password: string;
    readonly displayNameAr?: string | undefined;
    readonly displayNameEn?: string | undefined;
  },
): Promise<Result<InvitationAcceptOutcome, AppError>> {
  // Validated again here, right before the sign-up (whatever the page showed earlier): only a `valid`
  // lookup — which applies the acceptance checks, the inviter's authority included — leads to Auth. Auth's
  // hook applies the same rules itself; acceptance checks them a third time. A change between the
  // sign-up and the acceptance leaves an orphan Auth user, logged below for the operations runbook
  // (invitations contract § Operations).
  const valid = await validInvitation(deps, input.token);
  if (!valid) return notValid();
  const { invitation, tokenHash } = valid;
  const client = deps.signUpClient;
  if (!client || !deps.auth.supabase) return err(appError('NOT_CONFIGURED'));
  // A new account belongs to the invited organization only: its rule applies (T-M2-10, PO decision 5),
  // checked before Auth creates anything. The answer names the length, never the organization's settings.
  const min = await deps.invitationPasswordMinLength(tokenHash);
  if (passwordLength(input.password) < min) {
    return err(
      appError(InvitationErrors.INVITATION_PASSWORD_TOO_SHORT, {
        params: { min },
        fieldErrors: [{ path: 'password', code: 'TOO_SMALL', params: { min } }],
      }),
    );
  }

  // The e-mail comes from the invitation, never from the form; the token travels raw (the hook hashes
  // it), so nothing Auth stores can be replayed against the database.
  const { data, error } = await client.auth.signUp({
    email: invitation.email,
    password: input.password,
    options: { data: { invitation: input.token } },
  });
  if (error) return signUpRefusal(deps, error);
  const tokens = sessionTokens(data);
  if (!tokens) {
    // Auth created no session: e-mail confirmation is on (it must be off, db-deploy.md), and Auth answers
    // an existing account the same way. Either way the invitee continues with "sign in to accept".
    deps.auth.logWarning(
      'invitation: sign-up answered without a session; is e-mail confirmation off?',
      {
        action: ACCEPT_ACTION,
      },
    );
    return err(appError(InvitationErrors.INVITATION_ACCOUNT_EXISTS));
  }
  const claims = await verifyClaims(deps.auth.supabase, tokens.accessToken);
  if (!claims.ok) {
    await endSession(deps, ACCEPT_ACTION);
    return claims;
  }
  const userId = claims.value.sub;
  await clearInvitationMetadata(deps, client);

  // From here on the account exists: when the acceptance is refused or fails, the session just opened
  // is ended again (it belongs to no organization) and the account is logged as an orphan with its id
  // and the link's state (no e-mail, no names). A retry of a still-valid link takes the "sign in to
  // accept" path with the password chosen here.
  const orphan = async (notValidCode: boolean) => {
    deps.auth.logWarning('invitation: Auth user created but the invitation was not accepted', {
      action: ACCEPT_ACTION,
      reason: 'orphan_auth_user',
      entityType: 'auth_user',
      entityId: userId,
      state: await currentState(deps, tokenHash),
      ...(notValidCode ? { errorCode: INVITATION_NOT_VALID_CODE } : {}),
    });
    await endSession(deps, ACCEPT_ACTION);
  };
  let result: Result<InvitationAcceptOutcome, AppError>;
  try {
    result = await acceptAsCallerAndEnter(deps, claims.value, tokenHash, tokens, {
      ar: cleanName(input.displayNameAr),
      en: cleanName(input.displayNameEn),
    });
  } catch (error) {
    await orphan(false);
    throw error;
  }
  if (!result.ok) await orphan(result.error.code === INVITATION_NOT_VALID_CODE);
  return result;
}

async function acceptAsCallerAndEnter(
  deps: InvitationAcceptDeps,
  claims: VerifiedClaims,
  tokenHash: Buffer,
  tokens?: SessionTokens,
  displayName?: { readonly ar: string | null; readonly en: string | null },
): Promise<Result<InvitationAcceptOutcome, AppError>> {
  let tenantId: string;
  try {
    ({ tenantId } = await deps.auth.withUserTx(claims, (tx) =>
      displayName
        ? deps.acceptInvitationAsCaller(tx, tokenHash, displayName)
        : deps.acceptInvitationAsCaller(tx, tokenHash),
    ));
  } catch (error) {
    const refusal = callerRefusal(error);
    if (refusal) return err(refusal);
    throw error;
  }
  // The membership exists now; open the new organization in this session (its MFA policy may ask for an
  // authenticator app next: screen 8, step 2).
  const selected = await selectOrganization(deps.auth, tenantId, tokens);
  return ok({ next: selected.ok ? selected.value.next : 'choose-organization' });
}

/** "Sign in to accept": password sign-in as the invitation e-mail, then accept as that user. */
export async function acceptInvitationWithPassword(
  deps: InvitationAcceptDeps,
  input: { readonly token: string; readonly password: string },
): Promise<Result<InvitationAcceptOutcome, AppError>> {
  const valid = await validInvitation(deps, input.token);
  if (!valid) return notValid();
  // The e-mail comes from the invitation, never from the form.
  const session = await startPasswordSession(deps.auth, {
    email: valid.invitation.email,
    password: input.password,
  });
  if (!session.ok) return session;
  // The session exists only to accept: when the acceptance fails it is ended again (the visitor was
  // not signed in before and must not stay signed in to an account with no organization from here).
  let result: Result<InvitationAcceptOutcome, AppError>;
  try {
    result = await acceptAsCallerAndEnter(
      deps,
      session.value.claims,
      valid.tokenHash,
      session.value.tokens,
    );
  } catch (error) {
    await endSession(deps);
    throw error;
  }
  if (!result.ok) await endSession(deps);
  return result;
}

/** Signs the just-opened session out (local scope); never fails the answer. */
async function endSession(
  deps: InvitationAcceptDeps,
  action = 'platform.invitation.accept_with_sign_in',
): Promise<void> {
  let failed: boolean;
  try {
    const answer = await deps.auth.supabase?.auth.signOut({ scope: 'local' });
    failed = Boolean(answer?.error);
  } catch {
    failed = true;
  }
  if (failed) {
    deps.auth.logWarning(
      'invitation: could not end the sign-in session after a refused acceptance',
      { action },
    );
  }
}

/** Already signed in as the invited account: accept with the current (Auth-confirmed) session. */
export async function acceptInvitationAsSignedInUser(
  deps: InvitationAcceptDeps,
  input: { readonly token: string },
): Promise<Result<InvitationAcceptOutcome, AppError>> {
  // Strict: the Auth server confirms the session is live before it gains a membership.
  const claims = await verifyClaimsStrict(deps.auth.supabase);
  if (!claims.ok) return claims;
  const valid = await validInvitation(deps, input.token);
  if (!valid) return notValid();
  // Early, clearer answer; the database checks the Auth e-mail itself (accept_invitation_as_caller).
  if (sessionEmail(claims.value) !== valid.invitation.email.toLowerCase()) {
    return err(appError(InvitationErrors.INVITATION_OTHER_ACCOUNT));
  }
  return acceptAsCallerAndEnter(deps, claims.value, valid.tokenHash);
}
