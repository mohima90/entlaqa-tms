import { defaultActionRuntime } from './default-runtime';
import { createDefineAction } from './define-action';

export * from './permissions';
export * from './scopes';
export * from './authorize';
export {
  type ActionContext,
  type ActionDefinition,
  type ActionResult,
  type ActionRuntime,
  type ActionTarget,
  type AuditRecord,
  type GetClaimsOptions,
  type ResourceRef,
  type ServerAction,
  DEFINE_ACTION_MARKER,
  createDefineAction,
  requiresStrictVerification,
} from './define-action';

/** The one way to declare a server action (ADR 0003 §4). */
export const defineAction = createDefineAction(defaultActionRuntime);
