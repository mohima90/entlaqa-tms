import 'server-only';
import { createHash } from 'node:crypto';
import {
  type PublicBrandAsset,
  type PublicBrandAssetMeta,
  type RateLimit,
  type RateLimitCounter,
  isDatabaseConfigured,
  publicBrandAsset,
  publicBrandAssetMeta,
  rateLimitStore,
} from '@jadarat/platform-db';
import { type LogFields, log } from '@jadarat/platform-observability';
import { requestClientFrom } from './request-client';
import { BRAND_IMAGE_CSP } from './security-headers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * How long browsers and shared caches (CDN, reverse proxy) keep a copy: one day (security review M1). A copy
 * never changes — a new image gets a new id — but a REMOVED image should stop being served within a day; a
 * browser revalidates after that with If-None-Match, answered with 304 from a metadata query (no bytes read).
 * Mail clients' image proxies keep their own copy for as long as they choose (docs/engineering/branding.md).
 */
export const BRAND_IMAGE_MAX_AGE_SECONDS = 86_400;

/** Full image answers (200) per client and minute; visitors without a trusted address share a larger budget. */
export const BRAND_IMAGE_LIMITS: Readonly<{ client: RateLimit; shared: RateLimit }> = {
  client: { max: 120, windowSeconds: 60 },
  shared: { max: 1200, windowSeconds: 60 },
};
const BUCKET = 'brand.images';
const SUBJECT_DOMAIN = 'jadarat.rate-limit.v1\nbrand-image-client\n';

/** Headers every answer for a copy carries (200 and 304): the policy, caching and the validator. */
function commonHeaders(meta: { readonly sha256: string }): Record<string, string> {
  const cache = `public, max-age=${BRAND_IMAGE_MAX_AGE_SECONDS}`;
  return {
    'Cache-Control': `${cache}, s-maxage=${BRAND_IMAGE_MAX_AGE_SECONDS}`,
    // Vercel's CDN and standard CDNs read this one (RFC 9213); self-hosted reverse proxies: branding.md.
    'CDN-Cache-Control': cache,
    ETag: `"${meta.sha256}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': BRAND_IMAGE_CSP,
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

/**
 * Headers of a branding image: the type the scan detected (never sniffed by the browser), inline, a strict
 * policy (the image cannot run anything even when opened directly), embeddable by mail clients
 * (Cross-Origin-Resource-Policy: cross-origin), cacheable for a day (the ETag is its SHA-256).
 */
export function brandImageHeaders(asset: PublicBrandAsset): Headers {
  return new Headers({
    ...commonHeaders(asset),
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.content.byteLength),
    'Content-Disposition': 'inline',
  });
}

const plain = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': BRAND_IMAGE_CSP,
      ...extra,
    },
  });

/** Does If-None-Match name this copy (a list, weak validators and `*` included)? */
export function matchesEtag(ifNoneMatch: string | null, sha256: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === `"${sha256}"`);
}

export interface BrandImageDeps {
  readonly configured: () => boolean;
  readonly load: (id: string) => Promise<PublicBrandAsset | null>;
  readonly loadMeta: (id: string) => Promise<PublicBrandAssetMeta | null>;
  /** One hit of the shared limiter (platform-db rateLimitStore). */
  readonly hit: (subject: Uint8Array, limit: RateLimit) => Promise<RateLimitCounter>;
  readonly warn: (message: string, fields: LogFields) => void;
}

const defaultDeps: BrandImageDeps = {
  configured: () => isDatabaseConfigured('app_server'),
  load: publicBrandAsset,
  loadMeta: publicBrandAssetMeta,
  hit: (subject, limit) => rateLimitStore.hit(BUCKET, subject, limit),
  warn: (message, fields) => {
    log.warn(message, fields);
  },
};

/**
 * Counts a full answer for the client: null within budget, else the seconds to wait. Fails OPEN (logged):
 * an image decides nothing about access, and the CDN cache stands in front.
 */
async function withinBudget(request: Request, deps: BrandImageDeps): Promise<number | null> {
  const client = requestClientFrom((name) => request.headers.get(name));
  const limit = client.key === null ? BRAND_IMAGE_LIMITS.shared : BRAND_IMAGE_LIMITS.client;
  const subject = createHash('sha256')
    .update(SUBJECT_DOMAIN)
    .update(client.key ?? 'unknown')
    .digest();
  try {
    const counter = await deps.hit(subject, limit);
    if (counter.allowed) return null;
    deps.warn('branding image requests limited', {
      action: 'platform.brand_image.rate_limited',
      outcome: 'denied',
      status: 429,
    });
    return Math.max(counter.retryAfterSeconds, 1);
  } catch {
    deps.warn('branding image limiter unavailable; served', {
      action: 'platform.brand_image.rate_limit_unavailable',
    });
    return null;
  }
}

/**
 * The response for /api/brand/<id>: the image; 304 when the browser (or a cache) already holds this copy —
 * answered from a metadata query, the bytes are not read; 429 past the client's budget of full answers; 404
 * for anything else (unknown, removed, an organization not in service, a malformed id, no database) — the
 * same answer, so nothing can be learnt.
 */
export async function brandImageResponse(
  request: Request,
  id: string,
  deps: BrandImageDeps = defaultDeps,
): Promise<Response> {
  if (!UUID.test(id) || !deps.configured()) return plain(404);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch !== null) {
    const meta = await deps.loadMeta(id);
    if (!meta || !IMAGE_TYPES.has(meta.contentType)) return plain(404);
    if (matchesEtag(ifNoneMatch, meta.sha256)) {
      return new Response(null, { status: 304, headers: commonHeaders(meta) });
    }
  }
  const retryAfter = await withinBudget(request, deps);
  if (retryAfter !== null) return plain(429, { 'Retry-After': String(retryAfter) });
  const asset = await deps.load(id);
  if (!asset || !IMAGE_TYPES.has(asset.contentType)) return plain(404);
  return new Response(new Uint8Array(asset.content), {
    status: 200,
    headers: brandImageHeaders(asset),
  });
}
