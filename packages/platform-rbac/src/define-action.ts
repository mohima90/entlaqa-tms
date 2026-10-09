import {
  type ActorContext,
  type AppError,
  type Result,
  type TenantClaims,
  type VerifiedClaims,
  actorFromClaims,
  appError,
  codeIsFresh,
  err,
  hasTenant,
  internalError,
  newCorrelationId,
  ok,
  parseInput,
  toClientError,
} from '@jadarat/platform-core';
import type { z } from 'zod';
import { type AuthorizationDecision, type Grant, authorize } from './authorize';
import type { PermissionDefinition } from './permissions';
import type { ResourceAttributes } from './scopes';

/**
 * What `ctx.can` checks: one resource (its scope must cover it), `'tenant'` (a tenant-wide grant, like
 * an action without a resource) or `'any'` (a grant in any scope — the caller restricts by scope).
 */
export type PermissionTarget = ResourceAttributes | 'tenant' | 'any';

/** Reference to the resource an action touches; attributes are loaded server-side. */
export interface ResourceRef {
  readonly type: string;
  readonly id: string;
}

export interface AuditRecord {
  /** Namespaced action, e.g. `tms.session.created`. */
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  /** Before/after values or other context. Never secrets; minimise personal data. */
  readonly data?: Record<string, unknown>;
}

export type PermissionAccess = 'allowed' | 'step_up_required' | 'denied';

export interface ActionContext<Tx> {
  readonly claims: TenantClaims;
  readonly actor: ActorContext;
  /**
   * The grants that authorize this call (never empty). With `resource`: the grants covering it.
   * Tenant-wide actions: the member's `tenant`-scope grants. `scoped: true` actions: ALL grants for the
   * permission — the handler MUST restrict every query to their union (scopeFilter, ADR 0003 §4.2).
   */
  readonly grants: readonly [Grant, ...Grant[]];
  readonly resource: ResourceAttributes | null;
  /**
   * Does the member also hold `permission` for `target`? Deny by default (also when it needs AAL2 and
   * the session is AAL1). For deciding what else a page or action may show (e.g. roles or the audit
   * trail on a profile); it never replaces the definition's own permission.
   */
  readonly can: (permission: PermissionDefinition, target: PermissionTarget) => boolean;
  /**
   * Like `can`, but tells "allowed after an authenticator code" (`step_up_required`: the member holds
   * the permission but the session is AAL1) apart from `denied` — so a page can say what is needed.
   */
  readonly access: (permission: PermissionDefinition, target: PermissionTarget) => PermissionAccess;
  /**
   * The member's grants in force for another permission (empty when none, or when it needs AAL2 and the
   * session is AAL1) — to restrict what a scoped list shows for it, e.g. roles per row.
   */
  readonly grantsFor: (permission: PermissionDefinition) => readonly Grant[];
  /** Transaction opened by withUserTx: RLS applies as the signed-in user. */
  readonly tx: Tx;
}

export interface GetClaimsOptions {
  /**
   * true → also confirm the session with the Auth server (getUser round-trip) so a revoked session is
   * refused immediately. defineAction sets it for high-risk and AAL2 permissions (ADR 0003 §2).
   */
  readonly strict: boolean;
}

/**
 * What the database says about the session (T-M2-10; security review L1/H1), in the action's transaction:
 * - `active`: it may act in its organization now — the same decision as every tenant policy
 *   (private.current_tenant_id(): live session, membership, the organization's MFA policy and session
 *   rules). An inactive session does nothing, also with member-level permissions (own profile, sessions).
 * - `aal2`: it passed a code from a CONFIRMED authenticator app (private.request_aal2(): the lower of the
 *   token's claim and the Auth session's own level).
 */
export interface SessionFacts {
  readonly active: boolean;
  readonly aal2: boolean;
}

/** Infrastructure used by defineAction; the default wires identity + platform-db (default-runtime.ts). */
export interface ActionRuntime<Tx> {
  getClaims(options: GetClaimsOptions): Promise<Result<VerifiedClaims, AppError>>;
  withUserTx<T>(claims: VerifiedClaims, fn: (tx: Tx) => Promise<T>): Promise<T>;
  loadSessionFacts(tx: Tx): Promise<SessionFacts>;
  loadGrants(tx: Tx, claims: TenantClaims): Promise<readonly Grant[]>;
  resolveResource(
    tx: Tx,
    ref: ResourceRef,
    claims: TenantClaims,
  ): Promise<ResourceAttributes | null>;
  writeAudit(tx: Tx, actor: ActorContext, record: AuditRecord): Promise<void>;
  logError(
    error: unknown,
    meta: { readonly permission: string; readonly correlationId: string },
  ): void;
}

/**
 * What the action is authorized against (ADR 0003 §3–§4):
 * - `resource`: one resource; some grant's scope must cover it (else 404).
 * - neither: a TENANT-WIDE action; requires a grant with scope `tenant` (else 403).
 * - `scoped: true`: no single resource; the handler receives all grants and must use scopeFilter.
 */
export type ActionTarget<S extends z.ZodType> =
  | {
      /** Maps validated input to the resource whose scope must cover the actor. */
      readonly resource: (input: z.output<S>) => ResourceRef;
      readonly scoped?: never;
    }
  | { readonly resource?: never; readonly scoped?: boolean };

export type ActionDefinition<S extends z.ZodType, O, Tx> = ActionTarget<S> & {
  readonly permission: PermissionDefinition;
  /** zod schema — untrusted input is validated before authorization and the handler run. */
  readonly input: S;
  /** Audit record for the change (create/update/delete/sensitive read). */
  readonly audit?: (input: z.output<S>, output: O) => AuditRecord | null;
  readonly handler: (args: {
    readonly ctx: ActionContext<Tx>;
    readonly input: z.output<S>;
  }) => Promise<Result<O, AppError>>;
};

/** What a server action returns to the client: serializable, no internals. */
export type ActionResult<O> = Result<O, AppError>;

export type ServerAction<I, O> = (input: I) => Promise<ActionResult<O>>;

/** Marker so tooling/tests can recognise actions created by defineAction. */
export const DEFINE_ACTION_MARKER = Symbol.for('jadarat.defineAction');

/** Expected failure raised inside the transaction so it rolls back; returned to the caller as-is. */
class HandledFailure extends Error {
  override readonly name = 'HandledFailure';
  constructor(readonly error: AppError) {
    super(error.code);
  }
}

function denial(decision: Extract<AuthorizationDecision, { allowed: false }>): AppError {
  switch (decision.reason) {
    case 'missing_permission':
    case 'insufficient_scope':
      return appError('FORBIDDEN');
    case 'out_of_scope':
      return appError('NOT_FOUND');
    case 'step_up_required':
      return appError('STEP_UP_REQUIRED');
  }
}

/** High-risk and AAL2 permissions re-confirm the session with the Auth server (ADR 0003 §2). */
export function requiresStrictVerification(permission: PermissionDefinition): boolean {
  return permission.risk === 'high' || permission.requiresAal2;
}

/**
 * Creates `defineAction` bound to a runtime (ADR 0003 §4). Every server action and mutating route in
 * modules/** and packages/platform-*\/** must be created with it (CI: scripts/check-server-actions.mjs).
 *
 * Pipeline: verify session (strict getUser round-trip for high-risk / AAL2 permissions) → require
 * tenant claim → validate input → withUserTx {
 *   session facts (inactive → UNAUTHENTICATED) → load effective grants → resolve resource → authorize
 *   (deny by default; AAL2 permissions need the database's AAL2 AND a code from the last
 *   STEP_UP_MAX_AGE_SECONDS, else STEP_UP_REQUIRED) → handler → audit } .
 */
export function createDefineAction<Tx>(runtime: ActionRuntime<Tx>) {
  return function defineAction<S extends z.ZodType, O>(
    definition: ActionDefinition<S, O, Tx>,
  ): ServerAction<z.input<S>, O> {
    const action = async (rawInput: z.input<S>): Promise<ActionResult<O>> => {
      const claims = await runtime.getClaims({
        strict: requiresStrictVerification(definition.permission),
      });
      if (!claims.ok) return err(toClientError(claims.error));
      if (!hasTenant(claims.value)) {
        return err(appError('FORBIDDEN'));
      }
      const tenantClaims = claims.value;

      const input = parseInput(definition.input, rawInput);
      if (!input.ok) return input;

      try {
        return await runtime.withUserTx(tenantClaims, async (tx) => {
          const actor = actorFromClaims(tenantClaims);
          // Tenant-scoped work only while the database lets the session act there (review L1).
          const facts = await runtime.loadSessionFacts(tx);
          if (!facts.active) throw new HandledFailure(appError('UNAUTHENTICATED'));
          const grants = await runtime.loadGrants(tx, tenantClaims);
          const resource = definition.resource
            ? await runtime.resolveResource(tx, definition.resource(input.value), tenantClaims)
            : undefined;
          const subject = {
            tenantId: actor.tenantId,
            personId: actor.personId,
            // AAL2 for authorization: the token, the database (confirmed app) and a fresh code (L3).
            aal:
              actor.aal === 'aal2' && facts.aal2 && codeIsFresh(tenantClaims)
                ? ('aal2' as const)
                : ('aal1' as const),
            grants,
          };
          const decision = authorize(subject, definition.permission, resource, {
            scoped: definition.scoped === true,
          });
          if (!decision.allowed) throw new HandledFailure(denial(decision));

          const output = await definition.handler({
            ctx: {
              claims: tenantClaims,
              actor,
              grants: decision.grants,
              resource: resource ?? null,
              can: (permission, target) =>
                authorize(subject, permission, typeof target === 'string' ? undefined : target, {
                  scoped: target === 'any',
                }).allowed,
              access: (permission, target) => {
                const decision = authorize(
                  subject,
                  permission,
                  typeof target === 'string' ? undefined : target,
                  { scoped: target === 'any' },
                );
                if (decision.allowed) return 'allowed';
                return decision.reason === 'step_up_required' ? 'step_up_required' : 'denied';
              },
              grantsFor: (permission) => {
                const other = authorize(subject, permission, undefined, { scoped: true });
                return other.allowed ? other.grants : [];
              },
              tx,
            },
            input: input.value,
          });
          // Throwing rolls the transaction back.
          if (!output.ok) throw new HandledFailure(output.error);

          const record = definition.audit?.(input.value, output.value);
          if (record) await runtime.writeAudit(tx, actor, record);
          return ok(output.value);
        });
      } catch (error) {
        if (error instanceof HandledFailure) return err(toClientError(error.error));
        // Unexpected: log with a correlation id; the client gets INTERNAL_ERROR + the same id only.
        const correlationId = newCorrelationId();
        runtime.logError(error, { permission: definition.permission.code, correlationId });
        return err(internalError(correlationId));
      }
    };
    return Object.assign(action, { [DEFINE_ACTION_MARKER]: definition.permission.code });
  };
}
