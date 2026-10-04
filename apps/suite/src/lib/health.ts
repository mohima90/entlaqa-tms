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

/**
 * Readiness results are reused for 5 s after a probe ends, and concurrent requests share one running
 * probe: however often the public endpoint is called, at most one `select 1` per instance is in flight.
 */
const READY_CACHE_MS = 5_000;
let cached: { readonly at: number; readonly result: DatabaseHealth } | undefined;
let inflight: Promise<DatabaseHealth> | undefined;

/** Readiness: the app can serve requests (database reachable as app_server). 503 otherwise. */
export async function readyResponse(
  check: () => Promise<DatabaseHealth> = () => checkDatabase(),
  now: () => number = Date.now,
): Promise<Response> {
  let result: DatabaseHealth;
  if (cached && now() - cached.at < READY_CACHE_MS) {
    result = cached.result;
  } else {
    inflight ??= check()
      .catch((): DatabaseHealth => 'unavailable')
      .then((value) => {
        cached = { at: now(), result: value };
        return value;
      })
      .finally(() => {
        inflight = undefined;
      });
    result = await inflight;
  }
  const ok = result === 'ok';
  return Response.json(
    { status: ok ? 'ok' : 'unavailable' },
    { status: ok ? 200 : 503, headers: HEADERS },
  );
}

/** Test hook. */
export function resetReadyCache(): void {
  cached = undefined;
  inflight = undefined;
}
