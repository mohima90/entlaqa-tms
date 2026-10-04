/**
 * Next.js instrumentation (ADR 0009 §4, T-M1-D06): error tracking and readable server stack traces.
 * Server code runs on the Node.js runtime only (the request proxy included), so nothing is set up for
 * the Edge runtime. Settings are read at runtime: one build serves every deployment (ADR 0010).
 */
import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startObservability } = await import('./lib/observability');
  startObservability();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { handleRequestError } = await import('./lib/observability');
  handleRequestError(error, request, context);
};
