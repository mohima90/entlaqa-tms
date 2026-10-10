import 'server-only';
import { type CookieMethodsServer, type CookieOptions, createServerClient } from '@supabase/ssr';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { type SupabasePublicConfig, readSupabasePublicConfigFromEnv } from './config';
import { storageRoutingFetch } from './storage';

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
 * Extra request headers sent with every Auth call of a client. Used for the visitor's rate-limit key on
 * self-hosted installations, whose gateway trusts it from the app's network only and hands it to Auth's
 * own per-IP limits (T-M2-11; JADARAT_AUTH_CLIENT_HEADER). Never secrets.
 */
export interface AuthClientOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

function globalHeaders(
  options: AuthClientOptions,
  userAgent: string | null = null,
): { global?: { headers: Record<string, string> } } {
  const headers = { ...options.headers, ...(userAgent ? { 'User-Agent': userAgent } : {}) };
  return Object.keys(headers).length > 0 ? { global: { headers } } : {};
}

/**
 * The server client's `global` options: the headers above and, with a Storage origin, the fetch that sends
 * Storage's API calls there (T-M2-18).
 */
function globalOptions(options: SupabaseServerClientOptions, userAgent: string | null) {
  const { global } = globalHeaders(options, userAgent);
  if (!options.storageOrigin) return global ? { global } : {};
  return { global: { ...global, fetch: storageRoutingFetch(options.storageOrigin) } };
}

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

export interface SupabaseServerClientOptions extends AuthClientOptions {
  /**
   * The browser's User-Agent, sent to Auth instead of the server's own (T-M2-10); see forwardableUserAgent.
   */
  readonly userAgent?: string | null;
  /**
   * Where Storage's API is reached (readStorageInternalOrigin; self-hosted: the gateway's internal port).
   * Null or absent: the Supabase URL (T-M2-18).
   */
  readonly storageOrigin?: string | null;
}

/**
 * Server-side Supabase client (publishable key + the user's session cookies) for Auth and Storage.
 * Never used to read tenant tables (ADR 0003 §4). Returns null when Supabase is not configured.
 * `userAgent`: the browser's, sent to Auth instead of the server's own so that the session Auth creates at
 * sign-in records the real browser (the session lists show browser and system, T-M2-10); `headers`: see
 * AuthClientOptions (T-M2-11); `storageOrigin`: where Storage's API is asked (T-M2-18).
 */
export function createSupabaseServerClient(
  cookies: CookieMethodsServer,
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
  options: SupabaseServerClientOptions = {},
): SupabaseClient | null {
  if (!config) return null;
  const userAgent = forwardableUserAgent(options.userAgent);
  return createServerClient(config.url, config.publishableKey, {
    cookies,
    cookieOptions: SESSION_COOKIE_OPTIONS,
    ...globalOptions(options, userAgent),
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
  options: AuthClientOptions = {},
): SupabaseClient | null {
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
    ...globalHeaders(options),
  });
}

/** The cookie-less client used to check a password (see createSupabaseStatelessClient). */
export function createSupabaseVerifierClient(
  config: SupabasePublicConfig | null = getSupabasePublicConfig(),
): SupabaseClient | null {
  return createSupabaseStatelessClient(config);
}

export {
  FileStorageError,
  type SignedUpload,
  STORAGE_INTERNAL_URL_ENV,
  STORAGE_PUBLIC_URL_ENV,
  type UserFileStorage,
  createUserFileStorage,
  readStorageInternalOrigin,
  readStoragePublicOrigin,
  storageErrorOf,
  storageRoutingFetch,
  toPublicUrl,
} from './storage';
