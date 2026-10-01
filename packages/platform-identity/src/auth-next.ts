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
import { createSupabaseServerClient } from '@jadarat/platform-db/supabase-server';
import { cookies } from 'next/headers';
import {
  type AuthClientLike,
  type AuthFlowDeps,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
} from './auth-flow';

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
    logWarning: (message, meta) => {
      console.warn(`[auth] ${message}`, meta);
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
