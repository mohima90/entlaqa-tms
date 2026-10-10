/**
 * Next.js adapter: verified claims for the current request (server components, server actions,
 * route handlers). Cookie writes from server components are ignored — the request proxy refreshes
 * sessions (ADR 0003 §2); server actions and route handlers may write cookies.
 */
import 'server-only';
import type { AppError, Result, VerifiedClaims } from '@jadarat/platform-core';
import { createSupabaseServerClient } from '@jadarat/platform-db/supabase-server';
import { cookies, headers } from 'next/headers';
import { verifyClaims, verifyClaimsStrict } from './verify-claims';

async function requestSupabase() {
  const store = await cookies();
  // A refresh here (server actions) records the browser's User-Agent on the session, as in the proxy
  // (session lists, T-M2-10).
  const userAgent = (await headers()).get('user-agent');
  return createSupabaseServerClient(
    {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
        }
      },
    },
    undefined,
    { userAgent },
  );
}

export async function getVerifiedClaims(): Promise<Result<VerifiedClaims, AppError>> {
  return verifyClaims(await requestSupabase());
}

export async function getVerifiedClaimsStrict(): Promise<Result<VerifiedClaims, AppError>> {
  return verifyClaimsStrict(await requestSupabase());
}
