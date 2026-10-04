import 'server-only';
import { type DatabaseHealth, checkDatabase } from '@jadarat/platform-db';

/**
 * Health endpoints (ADR 0009 §6). Public by design (uptime monitors, container orchestrators), so they
 * return a bare status — no versions, hosts or error details. `no-store`: never served from a cache.
 */
const HEADERS = { 'cache-control': 'no-store' } as const;

/** Liveness: the process answers. */
export function liveResponse(): Response {
  return Response.json({ status: 'ok' }, { headers: HEADERS });
}

/** Readiness probe results are reused briefly, so the public endpoint cannot be used to load the DB. */
const READY_CACHE_MS = 5_000;
let cached: { readonly at: number; readonly result: DatabaseHealth } | undefined;

/** Readiness: the app can serve requests (database reachable as app_server). 503 otherwise. */
export async function readyResponse(
  check: () => Promise<DatabaseHealth> = () => checkDatabase(),
  now: () => number = Date.now,
): Promise<Response> {
  const time = now();
  if (!cached || time - cached.at >= READY_CACHE_MS) cached = { at: time, result: await check() };
  const ok = cached.result === 'ok';
  return Response.json(
    { status: ok ? 'ok' : 'unavailable' },
    { status: ok ? 200 : 503, headers: HEADERS },
  );
}

/** Test hook. */
export function resetReadyCache(): void {
  cached = undefined;
}
