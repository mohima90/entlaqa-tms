import { reportError } from '@jadarat/platform-observability';
import { defaultActionRuntime } from './default-runtime';
import { createDefineAction } from './define-action';
import { createDefinePublicAction } from './define-public-action';
import { createDefinePublicRoute } from './define-public-route';
import { createDefineQuery } from './define-query';
import { createLoadMemberGrants } from './member-grants';

export * from './permissions';
export * from './scopes';
export * from './authorize';
export * from './platform-permissions';
export * from './system-roles';
export * from './separation-of-duties';
export * from './role-matrix';
export * from './role-grants';
export * from './person-scope';
export * from './member-permissions';
export {
  type ActionContext,
  type ActionDefinition,
  type ActionResult,
  type ActionRuntime,
  type ActionTarget,
  type AuditRecord,
  type GetClaimsOptions,
  type PermissionAccess,
  type PermissionTarget,
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
export {
  type PublicRouteDefinition,
  type PublicRouteHandler,
  DEFINE_PUBLIC_ROUTE_MARKER,
  createDefinePublicRoute,
} from './define-public-route';

export { type AuthorizedQuery, type QueryDefinition, createDefineQuery } from './define-query';

export { createLoadMemberGrants } from './member-grants';
export * from './iam/users';
export * from './iam/my-profile';
export * from './iam/edit-user';
export * from './iam/edit-roles';
export * from './iam/roles-page';
export * from './iam/invitations';
export * from './iam/deactivation';
export * from './iam/security';

/** Authorized reads for server components and routes (same checks as defineAction, no audit). */
export const defineQuery = createDefineQuery(defaultActionRuntime);

/** The signed-in member's grants, for showing navigation entries only (pages authorize themselves). */
export const loadMemberGrants = createLoadMemberGrants(defaultActionRuntime);

/** The one way to declare a server action (ADR 0003 §4). */
export const defineAction = createDefineAction(defaultActionRuntime);

/**
 * Pre-tenant server actions (sign-in, organization selection, sign-out) — no permission check; allowed
 * only in apps/suite/src/auth/ (CI gate). See define-public-action.ts.
 */
export const definePublicAction = createDefinePublicAction({
  logError(error, meta) {
    // Logged (error class, action, correlation id — no personal data) and sent to the error tracker.
    reportError(error, { action: meta.action, correlationId: meta.correlationId });
  },
});

/**
 * Mutating route handlers without a session (e.g. browser error reports) — no permission check;
 * allowed only in the listed public route files (CI gate). See define-public-route.ts.
 */
export const definePublicRoute = createDefinePublicRoute({
  logError(error, meta) {
    reportError(error, { action: meta.action, correlationId: meta.correlationId });
  },
});
