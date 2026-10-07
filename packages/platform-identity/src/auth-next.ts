/**
 * Next.js adapter for the sign-in flow (auth-flow.ts): a Supabase client bound to the request cookies
 * (writable in server actions) and the platform-db functions. Used only by apps/suite/src/auth/
 * (definePublicAction) and the sign-in / organization pages.
 */
import 'server-only';
import {
  acceptInvitationAsCaller,
  hashInvitationToken,
  insertAuditEvent,
  invitationByToken,
  listSessionTenants,
  switchActiveTenant,
  withUserTx,
} from '@jadarat/platform-db';
import {
  createSupabaseServerClient,
  createSupabaseVerifierClient,
} from '@jadarat/platform-db/supabase-server';
import { log } from '@jadarat/platform-observability';
import { cookies } from 'next/headers';
import {
  type AuthClientLike,
  type AuthFlowDeps,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
} from './auth-flow';
import {
  type InvitationAcceptDeps,
  type InvitationLinkView,
  type InvitationSignUpClientLike,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithNewAccount,
  acceptInvitationWithPassword,
  lookupInvitationLink,
} from './invitation-accept';
import {
  type PasswordClientLike,
  type VerifierClientLike,
  changePassword,
  createPasswordVerifier,
} from './password';

async function requestDeps(): Promise<AuthFlowDeps> {
  const store = await cookies();
  const supabase = createSupabaseServerClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // Server Components cannot write cookies; the request proxy refreshes sessions there.
      }
    },
  });
  return {
    supabase: supabase as AuthClientLike | null,
    withUserTx,
    listSessionTenants,
    switchActiveTenant,
    insertAuditEvent,
    logWarning: (message, fields) => {
      log.warn(message, fields);
    },
  };
}

export async function signInWithPasswordForRequest(credentials: {
  readonly email: string;
  readonly password: string;
}) {
  return signInWithPassword(await requestDeps(), credentials);
}

export async function selectOrganizationForRequest(tenantId: string) {
  return selectOrganization(await requestDeps(), tenantId);
}

export async function getSessionOrganizationsForRequest() {
  return getSessionOrganizations(await requestDeps());
}

export async function signOutForRequest() {
  return signOut(await requestDeps());
}

export async function changePasswordForRequest(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}) {
  const deps = await requestDeps();
  return changePassword(
    {
      supabase: deps.supabase as unknown as PasswordClientLike | null,
      verifyPassword: createPasswordVerifier(
        () => createSupabaseVerifierClient() as VerifierClientLike | null,
        deps.logWarning,
      ),
      logWarning: deps.logWarning,
    },
    input,
  );
}

// Invitations (FR-IAM-03, T-M2-07). The new account signs up through the public Auth API with the same
// cookie-bound client (publishable key); Auth's before-user-created hook admits only a valid invitation.
// No Auth secret key in the web app (ADR 0002 §7 note T-M2-07, security review H1).

function invitationDeps(auth: AuthFlowDeps): InvitationAcceptDeps {
  return {
    auth,
    signUpClient: auth.supabase as unknown as InvitationSignUpClientLike | null,
    hashToken: hashInvitationToken,
    invitationByToken,
    acceptInvitationAsCaller,
  };
}

/**
 * What the accept page shows for a link: its state and, when valid, the details and who is looking
 * (no session needed). Called by the page's public lookup action with the token from the URL fragment.
 */
export async function lookupInvitationLinkForRequest(token: string): Promise<InvitationLinkView> {
  return lookupInvitationLink(
    { hashToken: hashInvitationToken, invitationByToken, auth: await requestDeps() },
    token,
  );
}

export async function acceptInvitationWithNewAccountForRequest(
  input: Parameters<typeof acceptInvitationWithNewAccount>[1],
) {
  return acceptInvitationWithNewAccount(invitationDeps(await requestDeps()), input);
}

export async function acceptInvitationWithPasswordForRequest(input: {
  readonly token: string;
  readonly password: string;
}) {
  return acceptInvitationWithPassword(invitationDeps(await requestDeps()), input);
}

export async function acceptInvitationAsSignedInUserForRequest(input: { readonly token: string }) {
  return acceptInvitationAsSignedInUser(invitationDeps(await requestDeps()), input);
}
