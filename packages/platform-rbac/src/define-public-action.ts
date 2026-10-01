import {
  type AppError,
  type Result,
  err,
  internalError,
  newCorrelationId,
  parseInput,
  toClientError,
} from '@jadarat/platform-core';
import type { z } from 'zod';
import type { ActionResult, ServerAction } from './define-action';

/**
 * A server action that runs BEFORE the caller has a tenant (ADR 0003 §2): sign-in, organization
 * selection, sign-out. It performs no permission check — the handler must establish everything it
 * relies on (Auth session, membership) through platform-identity — so the CI gate allows it only in
 * apps/suite/src/auth/ (scripts/lib/server-actions.mjs). Everything else uses defineAction().
 */
export interface PublicActionDefinition<S extends z.ZodType, O> {
  /** Namespaced name for logs, e.g. `platform.auth.sign_in`. Never contains personal data. */
  readonly name: string;
  /** zod schema — untrusted input is validated before the handler runs. */
  readonly input: S;
  readonly handler: (args: { readonly input: z.output<S> }) => Promise<Result<O, AppError>>;
}

export interface PublicActionRuntime {
  logError(error: unknown, meta: { readonly action: string; readonly correlationId: string }): void;
}

/** Marker so tooling/tests can recognise actions created by definePublicAction. */
export const DEFINE_PUBLIC_ACTION_MARKER = Symbol.for('jadarat.definePublicAction');

/**
 * Next.js signals redirect()/notFound() by throwing errors whose `digest` starts with `NEXT_`; they
 * must propagate to the framework instead of becoming INTERNAL_ERROR.
 */
function isFrameworkSignal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const digest = error.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

export function createDefinePublicAction(runtime: PublicActionRuntime) {
  return function definePublicAction<S extends z.ZodType, O>(
    definition: PublicActionDefinition<S, O>,
  ): ServerAction<z.input<S>, O> {
    const action = async (rawInput: z.input<S>): Promise<ActionResult<O>> => {
      const input = parseInput(definition.input, rawInput);
      if (!input.ok) return input;
      try {
        const output = await definition.handler({ input: input.value });
        return output.ok ? output : err(toClientError(output.error));
      } catch (error) {
        if (isFrameworkSignal(error)) throw error;
        const correlationId = newCorrelationId();
        runtime.logError(error, { action: definition.name, correlationId });
        return err(internalError(correlationId));
      }
    };
    return Object.assign(action, { [DEFINE_PUBLIC_ACTION_MARKER]: definition.name });
  };
}
