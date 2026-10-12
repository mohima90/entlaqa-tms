import { toClientError } from '@jadarat/platform-core';
import { userImportStatusQuery } from '../../../../../../../../lib/user-import-queries';

export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 404,
};

/**
 * «Is there anything new?» for the import page's poller (T-M2-12 integration review L1): the import's
 * version only (an opaque hash). A passive read — read-only and not the session's activity — so the page,
 * left open while the worker works, never keeps an idle session alive; the page refreshes itself (a real
 * request) only when the version changed. Same permission and visibility as the page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
): Promise<Response> {
  const { importId } = await params;
  const result = await userImportStatusQuery({ importId });
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (!result.ok) {
    const error = toClientError(result.error);
    return new Response(null, { status: STATUS[error.code] ?? 500, headers });
  }
  return Response.json({ version: result.value.version }, { headers });
}
