import 'server-only';
import { type CookieMethodsServer, type CookieOptions, createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type SupabasePublicConfig, readSupabasePublicConfig } from './config';

export { type SupabasePublicConfig } from './config';
export type { CookieMethodsServer };

/**
 * Session cookies (ADR 0003 §2): managed on the server only — HttpOnly, Secure (except local
 * development over http), SameSite=Lax, host-only (no Domain attribute). All auth flows are server
 * actions; there is no browser Supabase Auth client.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax',
  path: '/',
};

/**
 * Supabase public config from NEXT_PUBLIC_* variables. Must be read with literal `process.env.X`
 * accesses so Next.js can inline them.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  return readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

/**
 * Server-side Supabase client (publishable key + the user's session cookies) for Auth and Storage.
 * Never used to read tenant tables (ADR 0003 §4). Returns null when Supabase is not configured.
 */
export function createSupabaseServerClient(
  cookies: CookieMethodsServer,
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
): SupabaseClient | null {
  if (!config) return null;
  return createServerClient(config.url, config.publishableKey, {
    cookies,
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });
}
