import 'server-only';
import {
  type PublicBrandAsset,
  isDatabaseConfigured,
  publicBrandAsset,
} from '@jadarat/platform-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Headers of a branding image: the type the scan detected (never sniffed by the browser), inline, a strict
 * policy (the image cannot run anything even when opened directly), embeddable by mail clients
 * (Cross-Origin-Resource-Policy: cross-origin) and cacheable for a year — a copy never changes: a new image
 * gets a new id (the ETag is its SHA-256).
 */
export function brandImageHeaders(asset: PublicBrandAsset): Headers {
  return new Headers({
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.content.byteLength),
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${asset.sha256}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
}

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export interface BrandImageDeps {
  readonly configured: () => boolean;
  readonly load: (id: string) => Promise<PublicBrandAsset | null>;
}

const defaultDeps: BrandImageDeps = {
  configured: () => isDatabaseConfigured('app_server'),
  load: publicBrandAsset,
};

/**
 * The response for /api/brand/<id>: the image, or 404 for anything else (unknown, removed, an
 * organization not in service, a malformed id, no database) — the same answer, so nothing can be learnt.
 */
export async function brandImageResponse(
  id: string,
  deps: BrandImageDeps = defaultDeps,
): Promise<Response> {
  if (!UUID.test(id) || !deps.configured()) return notFound();
  const asset = await deps.load(id);
  if (!asset || !IMAGE_TYPES.has(asset.contentType)) return notFound();
  return new Response(new Uint8Array(asset.content), {
    status: 200,
    headers: brandImageHeaders(asset),
  });
}
