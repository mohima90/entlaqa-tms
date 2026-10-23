import 'server-only';
import { toClientError } from '@jadarat/platform-core';
import { BRAND_IMAGE_CSP } from './security-headers';
import { personPhotoQuery } from './users-queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * How long a browser keeps a photo before asking again: one hour. A new photo has a new address (`?v=` is
 * the start of its SHA-256), so only a REMOVED photo can outlive its removal, by at most this long — and
 * only where an old page still names it; revalidation (If-None-Match) costs no transfer.
 */
export const PERSON_PHOTO_MAX_AGE_SECONDS = 3600;

const STATUS: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 404,
};

/** Headers every answer for a photo carries: private to the browser, never sniffed, sandboxed. */
function commonHeaders(sha256: string): Record<string, string> {
  return {
    // `private`: only the signed-in member's own browser keeps it — no shared cache or CDN (BR-PPL-b).
    'Cache-Control': `private, max-age=${PERSON_PHOTO_MAX_AGE_SECONDS}`,
    ETag: `"${sha256}"`,
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': BRAND_IMAGE_CSP,
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

const plain = (status: number) =>
  new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': BRAND_IMAGE_CSP,
    },
  });

export interface PersonPhotoDeps {
  readonly load: typeof personPhotoQuery;
}

/**
 * The response for /api/photo/<person> (WP-ADM-04): a person's profile photo, to a signed-in member of the same
 * organization only (the query verifies the session; the database answers nothing to another organization).
 * 304 when the browser already holds this copy; 401 without a session; 404 for everything else (no photo, not in
 * this organization, a malformed id) — the same answer, so nothing can be learnt. A passive read: loading
 * avatars never keeps an idle session alive.
 */
export async function personPhotoResponse(
  request: Request,
  personId: string,
  deps: PersonPhotoDeps = { load: personPhotoQuery },
): Promise<Response> {
  if (!UUID.test(personId)) return plain(404);
  const result = await deps.load({
    personId,
    ifNoneMatch: request.headers.get('if-none-match'),
  });
  if (!result.ok) return plain(STATUS[toClientError(result.error).code] ?? 404);
  const photo = result.value;
  if (!IMAGE_TYPES.has(photo.contentType)) return plain(404);
  if (photo.notModified) {
    return new Response(null, { status: 304, headers: commonHeaders(photo.sha256) });
  }
  return new Response(new Uint8Array(photo.content), {
    status: 200,
    headers: {
      ...commonHeaders(photo.sha256),
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.content.byteLength),
      'Content-Disposition': 'inline',
    },
  });
}
