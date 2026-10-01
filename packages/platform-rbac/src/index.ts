import { defaultActionRuntime } from './default-runtime';
import { createDefineAction } from './define-action';
import { createDefinePublicAction } from './define-public-action';

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
export {
  type PublicActionDefinition,
  type PublicActionRuntime,
  DEFINE_PUBLIC_ACTION_MARKER,
  createDefinePublicAction,
} from './define-public-action';

/** The one way to declare a server action (ADR 0003 §4). */
export const defineAction = createDefineAction(defaultActionRuntime);

/**
 * Pre-tenant server actions (sign-in, organization selection, sign-out) — no permission check; allowed
 * only in apps/suite/src/auth/ (CI gate). See define-public-action.ts.
 */
export const definePublicAction = createDefinePublicAction({
  logError(error, meta) {
    // No personal data: the error class, the action name and the correlation id only.
    console.error('[definePublicAction] unexpected error', {
      action: meta.action,
      correlationId: meta.correlationId,
      error: error instanceof Error ? error.name : typeof error,
      // e.g. AuthServiceError: tells an outage (5xx) from a network failure (0); never personal data.
      ...(error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? { status: error.status }
        : {}),
    });
  },
});
