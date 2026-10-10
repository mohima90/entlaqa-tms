/**
 * Security headers (Development Plan §8.2 "CSP"; BRD Appendix H.2 step 4).
 * - Static headers apply to every response (next.config.ts headers()).
 * - The Content-Security-Policy carries a per-request nonce and is set by the proxy (src/proxy.ts)
 *   on every path except /_next/static, which gets STATIC_FALLBACK_CSP from next.config.ts.
 */

/** Request header carrying the per-request CSP nonce; owned by the proxy (client values are dropped). */
export const NONCE_HEADER = 'x-nonce';

export const staticSecurityHeaders = [
  // No `preload`: tenants bring custom domains (ADR 0002 §4) whose owners decide on HSTS preloading;
  // preload would also pin every subdomain of the platform domain into browsers irreversibly.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Legacy equivalent of CSP frame-ancestors 'none'.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny powerful features by default. QR check-in (camera) will enable camera=(self) on its route.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
] as const;

/**
 * Pages whose URL carries a secret — the invitation link token in the fragment `#token=` (T-M2-07,
 * FR-IAM-03), the password-reset token in `#token_hash=` (T-M2-08, FR-IAM-13) and the authenticator set-up
 * e-mail's "not you? remove this app" token in `#token=` (T-M2-10, FR-IAM-12; browsers never put
 * fragments in a Referer, and the pages remove them from the address bar at once): no referrer at all
 * anyway, as defence in depth (not even the path to a linked page). Applied after
 * `staticSecurityHeaders` in next.config.ts (the later entry wins for the same key); the pages also set
 * `<meta name="referrer" content="no-referrer">`.
 */
export const SECRET_URL_PAGES: readonly string[] = [
  '/:locale/invite/:path*',
  '/:locale/reset-password',
  '/:locale/mfa/remove',
];

export const secretUrlHeaders = [{ key: 'Referrer-Policy', value: 'no-referrer' }] as const;

/**
 * Strict CSP for responses that never pass the proxy (immutable build assets under /_next/static):
 * nothing may execute or be framed if such a file is opened directly (e.g. an SVG).
 */
export const STATIC_FALLBACK_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface CspOptions {
  readonly nonce: string;
  readonly isDev: boolean;
  /** Only when served over HTTPS (avoids breaking plain-HTTP local/E2E runs). */
  readonly upgradeInsecureRequests: boolean;
  /** Supabase project URL (Auth + Realtime from the browser), if configured. */
  readonly supabaseUrl?: string | undefined;
}

function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) return [];
  try {
    const url = new URL(supabaseUrl);
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return [url.origin, `${wsProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDev } = options;
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    ],
    // Dev tooling injects un-nonced styles; production requires the nonce.
    ['style-src', ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'"]],
    // Supabase origin: Realtime with an in-memory token only (ADR 0003 §4.4); no browser Auth client.
    ['connect-src', ["'self'", ...supabaseOrigins(options.supabaseUrl), ...(isDev ? ['ws:'] : [])]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (options.upgradeInsecureRequests) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** 128-bit random nonce, base64-encoded. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
