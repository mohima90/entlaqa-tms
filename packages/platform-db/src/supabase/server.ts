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
 * «Remember this browser» = «keep me signed in» (WP-ADM-05): a browser whose session was kept keeps this
 * HttpOnly marker, and its session cookies last (KEPT_SESSION_COOKIE_SECONDS, the longest kept session; the
 * database ends the session at the chosen period). Without the marker the session cookies end with the
 * browser. The marker decides nothing about access: a session is kept in the database
 * (private.kept_sessions), and every other rule still ends it.
 */
export const KEEP_SIGNED_IN_COOKIE =
  process.env.NODE_ENV === 'development' ? 'jadarat-keep' : '__Host-jadarat-keep';
export const KEPT_SESSION_COOKIE_SECONDS = 31 * 24 * 60 * 60;

type CookieWrite = Parameters<NonNullable<CookieMethodsServer['setAll']>>[0][number];

/** The cookie as Auth's client wants it set, with the lifetime of a kept or an ordinary browser session. */
function withSessionLifetime(cookie: CookieWrite, kept: boolean): CookieWrite {
  // Removals (an empty value, or already expired) stay removals.
  if (cookie.value === '' || cookie.options.maxAge === 0) return cookie;
  const { maxAge: _maxAge, expires: _expires, ...rest } = cookie.options;
  return { ...cookie, options: kept ? { ...rest, maxAge: KEPT_SESSION_COOKIE_SECONDS } : rest };
}

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
 * A client's `global` options: the headers above and, when there is a Storage origin or a visitor header,
 * the fetch that sends Storage's API calls to that origin (T-M2-18) and strips every visitor and
 * client-address header from them (integration review L2: the visitor key is for Auth's limits only).
 */
function globalOptions(
  options: AuthClientOptions & { readonly storageOrigin?: string | null },
  userAgent: string | null = null,
) {
  const { global } = globalHeaders(options, userAgent);
  const visitorHeaders = Object.keys(options.headers ?? {});
  if (!options.storageOrigin && visitorHeaders.length === 0) return global ? { global } : {};
  const fetch = storageRoutingFetch(options.storageOrigin ?? null, undefined, visitorHeaders);
  return { global: { ...global, fetch } };
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
  /**
   * Whether the session cookies this client writes are persistent (a session kept signed in) or end with the
   * browser. Default: the browser's keep marker (KEEP_SIGNED_IN_COOKIE) as sent with the request; a sign-in
   * flow passes its own answer, because the marker can only be set after Auth answered.
   */
  readonly keptSession?: () => boolean;
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
  const { setAll } = cookies;
  const lifetimeAware: CookieMethodsServer = setAll
    ? {
        ...cookies,
        setAll: async (toSet, headers) => {
          const kept =
            options.keptSession?.() ??
            (await cookies.getAll())?.some(
              (c) => c.name === KEEP_SIGNED_IN_COOKIE && c.value === '1',
            ) ??
            false;
          await setAll(
            toSet.map((cookie) => withSessionLifetime(cookie, kept)),
            headers,
          );
        },
      }
    : cookies;
  return createServerClient(config.url, config.publishableKey, {
    cookies: lifetimeAware,
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
    ...globalOptions(options),
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
  STORAGE_STRIPPED_HEADERS,
  type UserFileStorage,
  createUserFileStorage,
  readStorageInternalOrigin,
  readStoragePublicOrigin,
  storageErrorOf,
  storageRoutingFetch,
  toPublicUrl,
} from './storage';
