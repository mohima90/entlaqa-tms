import type { z } from 'zod';
import {
  type ActionDefinition,
  type ActionResult,
  type ActionRuntime,
  createDefineAction,
} from './define-action';

/** `Omit` per union member, so `resource` and `scoped` stay mutually exclusive. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A read for a page or route: the same authorization as an action, no audit, no server-action marker. */
export type QueryDefinition<S extends z.ZodType, O, Tx> = DistributiveOmit<
  ActionDefinition<S, O, Tx>,
  'audit'
>;

export type AuthorizedQuery<I, O> = (input: I) => Promise<ActionResult<O>>;

/**
 * Creates `defineQuery` bound to a runtime: authorized reads for server components (ADR 0003 §2, §4).
 * Pipeline identical to defineAction — verify the session (strict for high-risk permissions), require
 * the tenant claim, validate input, then in withUserTx: load grants → resolve resource → authorize
 * (deny by default; 403 / 404 / step-up) → handler. Lists use `scoped: true` and restrict their SQL to
 * the union of `ctx.grants` (e.g. personScopeFromGrants).
 *
 * Queries are not server actions: never export one from a 'use server' file (the CI gate allows only
 * defineAction there). Sensitive reads that must be audited are actions, not queries.
 */
export function createDefineQuery<Tx>(runtime: ActionRuntime<Tx>) {
  const defineAction = createDefineAction(runtime);
  return function defineQuery<S extends z.ZodType, O>(
    definition: QueryDefinition<S, O, Tx>,
  ): AuthorizedQuery<z.input<S>, O> {
    const run = defineAction(definition as ActionDefinition<S, O, Tx>);
    return (input) => run(input);
  };
}
