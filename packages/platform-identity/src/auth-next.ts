/**
 * Next.js adapter for the sign-in flow (auth-flow.ts): a Supabase client bound to the request cookies
 * (writable in server actions) and the platform-db functions. Used only by apps/suite/src/auth/
 * (definePublicAction) and the sign-in / organization pages.
 */
import 'server-only';
import {
  insertAuditEvent,
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
  AuthServiceError,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
} from './auth-flow';
import { type PasswordClientLike, type PasswordVerdict, changePassword } from './password';

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

/** Checks a password on a cookie-less client and ends the session it creates (password.ts). */
async function verifyPassword(email: string, password: string): Promise<PasswordVerdict> {
  const client = createSupabaseVerifierClient();
  if (!client) return 'invalid';
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return 'rate_limited';
    if (error.status !== undefined && error.status >= 400 && error.status < 500) return 'invalid';
    throw new AuthServiceError(error.status);
  }
  const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
  if (signOutError) {
    log.warn('could not end the password-check session', {
      action: 'platform.auth.change_password',
    });
  }
  return 'valid';
}

export async function changePasswordForRequest(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}) {
  const deps = await requestDeps();
  return changePassword(
    {
      supabase: deps.supabase as unknown as PasswordClientLike | null,
      verifyPassword,
      logWarning: deps.logWarning,
    },
    input,
  );
}
