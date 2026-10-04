import { newCorrelationId } from '@jadarat/platform-core';
import type { PublicActionRuntime } from './define-public-action';

/**
 * A mutating route handler that runs WITHOUT a session or tenant (ADR 0003 §2, §4.6) — e.g. the
 * browser error-report endpoint. It performs no permission check, so the handler must bound itself
 * (origin check, size and rate limits, no tenant data). The CI gate allows it only in the explicit list
 * of public route files (scripts/lib/server-actions.mjs); everything else uses defineRoute().
 */
export interface PublicRouteDefinition {
  /** Namespaced name for logs, e.g. `platform.observability.browser_error`. No personal data. */
  readonly name: string;
  readonly handler: (request: Request) => Promise<Response>;
}

export type PublicRouteHandler = (request: Request) => Promise<Response>;

/** Marker so tooling/tests can recognise handlers created by definePublicRoute. */
export const DEFINE_PUBLIC_ROUTE_MARKER = Symbol.for('jadarat.definePublicRoute');

function isFrameworkSignal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const digest = error.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

export function createDefinePublicRoute(runtime: PublicActionRuntime) {
  return function definePublicRoute(definition: PublicRouteDefinition): PublicRouteHandler {
    const route = async (request: Request): Promise<Response> => {
      try {
        return await definition.handler(request);
      } catch (error) {
        if (isFrameworkSignal(error)) throw error;
        const correlationId = newCorrelationId();
        runtime.logError(error, { action: definition.name, correlationId });
        // RFC 9457 problem details (ADR 0011): no internals, only the reference id.
        return Response.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'INTERNAL_ERROR',
            correlationId,
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }
    };
    return Object.assign(route, { [DEFINE_PUBLIC_ROUTE_MARKER]: definition.name });
  };
}
