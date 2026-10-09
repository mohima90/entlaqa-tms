import 'server-only';
import { type CookieMethodsServer, type CookieOptions, createServerClient } from '@supabase/ssr';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { type SupabasePublicConfig, readSupabasePublicConfigFromEnv } from './config';

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

/** Supabase public config, read from the runtime environment (see readSupabasePublicConfigFromEnv). */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  return readSupabasePublicConfigFromEnv();
}

/** A browser's User-Agent as Auth may record it: printable ASCII, at most 512 characters. */
const USER_AGENT = /^[\x20-\x7E]{1,512}$/;

/** The browser's User-Agent to forward to Auth, or null (absent, too long or not printable ASCII). */
export function forwardableUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return USER_AGENT.test(trimmed) ? trimmed : null;
}

/**
 * Server-side Supabase client (publishable key + the user's session cookies) for Auth and Storage.
 * Never used to read tenant tables (ADR 0003 §4). Returns null when Supabase is not configured.
 * `userAgent`: the browser's, sent to Auth instead of the server's own so that the session Auth creates at
 * sign-in records the real browser (the session lists show browser and system, T-M2-10).
 */
export function createSupabaseServerClient(
  cookies: CookieMethodsServer,
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
  options: { readonly userAgent?: string | null } = {},
): SupabaseClient | null {
  if (!config) return null;
  const userAgent = forwardableUserAgent(options.userAgent);
  return createServerClient(config.url, config.publishableKey, {
    cookies,
    cookieOptions: SESSION_COOKIE_OPTIONS,
    ...(userAgent ? { global: { headers: { 'User-Agent': userAgent } } } : {}),
  });
}

/**
 * A Supabase client WITHOUT the user's cookies: its session lives in this object's memory only and
 * never reaches the browser or the session cookies. Implicit flow, so no PKCE code verifier is created
 * or sent. Used for one-off Auth calls that must not touch the user's own session:
 *  - checking a password (the current password before a change, FR-IAM-16; that session is signed out
 *    right away by the caller);
 *  - password recovery (FR-IAM-13, T-M2-08): asking for the reset e-mail, and the short-lived recovery
 *    session that sets the new password and is signed out again in the same action.
 * Null when Supabase is not configured.
 */
export function createSupabaseStatelessClient(
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
): SupabaseClient | null {
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  });
}

/** The cookie-less client used to check a password (see createSupabaseStatelessClient). */
export function createSupabaseVerifierClient(
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
): SupabaseClient | null {
  return createSupabaseStatelessClient(config);
}
