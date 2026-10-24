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
  /**
   * `retryOnConflict`: run `fn` once more in a new transaction after a deadlock (40P01) or a
   * serialization failure (40001), telling `onRetry` the SQLSTATE first — see platform-db `UserTxOptions`.
   */
  withUserTx<T>(
    claims: VerifiedClaims,
    fn: (tx: Tx) => Promise<T>,
    options?: {
      readonly retryOnConflict?: boolean;
      readonly onRetry?: (sqlState: string) => void;
      /** An allow-listed read that is not the session's activity (platform-db PASSIVE_READS). */
      readonly passiveRead?: string;
    },
  ): Promise<T>;
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
  /**
   * A transaction rolled back by a conflict and run once more (operational warning): the permission and the
   * SQLSTATE only, never input or personal data.
   */
  logTransactionRetry?(meta: { readonly permission: string; readonly sqlState: string }): void;
  /**
   * `afterCommit` answered with an error after the transaction committed (operational warning, integration
   * review L-b): the permission and the error code only, never input or personal data.
   */
  logAfterCommitRefusal?(meta: { readonly permission: string; readonly code: string }): void;
  /**
   * Did the action's transaction queue work for the background worker on its own (it emitted a domain
   * event — platform-db emitEvent)? Asked at the end of the transaction; an action may also declare it
   * (`queuesWork`). Absent → only the declaration counts.
   */
  queuedWork?(tx: Tx): Promise<boolean>;
  /**
   * After the commit of an action that queued background work: ask for a worker pass now (ADR 0005 §1
   * amendment, 20 Oct 2026 — the web app starts the GitHub Jobs workflow after the response). Must not
   * throw or delay the answer; a throw is ignored.
   */
  requestWorkerPass?(meta: { readonly permission: string }): void | Promise<void>;
  /**
   * In the transaction of an action that declares `queuesAccountMail`: marks the account e-mail requests the
   * transaction created for an immediate e-mail (platform-db `tagInlineAccountMail`) and returns the key to send
   * them with, or null (WP-ADM-05 follow-up, PO 23 Oct 2026). Must not throw into the action: where the
   * database or the web app cannot do it, the worker sends the e-mail as before.
   */
  tagInlineAccountMail?(tx: Tx): Promise<unknown>;
  /**
   * After the commit: sends what `tagInlineAccountMail` marked, once the response has gone (it must return at
   * once, never delay the answer; a throw is ignored). The worker is the safety net.
   */
  sendInlineAccountMail?(ticket: unknown): void;
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

export type ActionDefinition<S extends z.ZodType, O, Tx, R = O, B = void> = ActionTarget<S> & {
  readonly permission: PermissionDefinition;
  /** zod schema — untrusted input is validated before authorization and the handler run. */
  readonly input: S;
  /** Audit record for the change (create/update/delete/sensitive read). */
  readonly audit?: (input: z.output<S>, output: O) => AuditRecord | null;
  /**
   * true when the handler acts OUTSIDE the database inside the transaction (calls Auth, sends something,
   * …). Such an action is never run a second time: by default an action whose transaction is rolled back
   * as a deadlock victim or after a serialization failure is retried once (T-M2-09 × T-M2-10 review L1),
   * which is safe only while everything it did was in that transaction.
   */
  readonly externalEffects?: boolean;
  /**
   * true when the action queues work for the background worker WITHOUT emitting a domain event (e.g. a
   * test e-mail request in a settings table): after the commit, the runtime asks for a worker pass
   * (`requestWorkerPass`). Actions that emit an event through platform-db `emitEvent`, or mark their
   * transaction with `noteWorkQueued` (work queued only in some cases), are detected on their own and need
   * not declare it. Never for a passive read.
   *
   * Detection limits (security review L2): only the action's OWN transaction object is looked at, and only
   * for `emitEvent` / `noteWorkQueued` calls. Work a SQL function or trigger queues by itself, work queued in
   * `beforeTransaction` or `afterCommit` (other transactions) and work queued by a job are not seen — declare
   * `queuesWork` for those. A missed kick only delays the work until the next scheduled pass (the per-minute
   * cron, GitHub's 5-minute schedule); a kick for nothing is a harmless empty pass.
   */
  readonly queuesWork?: boolean;
  /**
   * true when the action's transaction queues ACCOUNT E-MAIL requests for other people (a security-policy
   * change notice to the organization's admins, a sign-in unlock notice, an admin's authenticator reset):
   * they are tagged in the transaction and e-mailed at once after the commit instead of waiting for the worker
   * (WP-ADM-05 follow-up, PO 23 Oct 2026; `runtime.tagInlineAccountMail` / `sendInlineAccountMail`). The
   * worker still sends whatever the web app could not.
   */
  readonly queuesAccountMail?: boolean;
  /**
   * The name of an allow-listed read that does NOT count as the session's activity (platform-db
   * `PASSIVE_READS`, which refuses any other name; T-M2-12 integration review L1): its transaction is READ
   * ONLY and does not move the session's last activity, so a page polling it cannot keep an idle session
   * alive. The session is still verified and must still be active. Only for a status read a page polls
   * by itself — never with `audit`, `auditFailure`, `beforeTransaction`, `afterCommit` or
   * `externalEffects` (refused when the action is defined).
   */
  readonly passiveRead?: string;
  /**
   * Audit record for a REFUSED attempt the handler returned (e.g. a wrong current password —
   * `platform.auth.password_change_failed`, T-M2-11). The action's transaction has rolled back, so it is
   * written in a new transaction with the same verified claims. Best effort: a failure to write it is
   * logged and the caller still gets the handler's answer. Authorization denials are not passed here. It
   * gets the error and the actor only — never the input (which may hold secrets, e.g. passwords).
   */
  readonly auditFailure?: (error: AppError, actor: ActorContext) => AuditRecord | null;
  /**
   * Work that must happen BEFORE the action's transaction (after the session — the database's session
   * facts, in their own short transaction first: an inactive session never gets here — and the input were
   * checked, before authorization): e.g. counting the actor's own attempts on the shared rate limiter, whose short
   * transaction must never run while this action holds a pooled connection (two connections per request
   * can starve the pool — security review T-M2-11), and whose count must survive the action's rollback.
   * An error result is the action's answer (no transaction is opened); a throw is an internal error. Use it
   * only for per-actor work that is harmless for a caller the action would then refuse. Its value reaches
   * the handler as `before` (the same value again when the transaction is retried after a conflict) — e.g.
   * a file read from Storage with the user's session, which must never happen while the action holds a
   * pooled connection (WP-ADM-02 branding images).
   */
  readonly beforeTransaction?: (args: {
    readonly actor: ActorContext;
    readonly input: z.output<S>;
    /**
     * Runs `fn` in a short transaction of its own with the action's verified claims (RLS as the user), ended
     * before the next step — never nested in another (one pooled connection at a time). For a read the
     * per-actor work depends on (e.g. which images are new); the action's transaction must check again
     * whatever it relies on, as the state may change in between.
     */
    readonly read: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  }) => Promise<Result<B, AppError>>;
  readonly handler: (args: {
    readonly ctx: ActionContext<Tx>;
    readonly input: z.output<S>;
    /** What `beforeTransaction` answered (undefined without one). */
    readonly before?: B;
  }) => Promise<Result<O, AppError>>;
  /**
   * Work AFTER the action's transaction has committed (T-M2-18 integration review M1): run ONCE — never
   * inside the conflict retry, never for a refused or failed action — with no database connection held.
   * It gets the handler's committed result and returns the action's answer. For calls to another service
   * that must see the committed rows, e.g. asking Supabase Storage (its own database connection) for a
   * signed URL for the upload reservation or download grant the handler wrote. Keep the handler's work
   * complete on its own: if afterCommit fails, the transaction stays committed (an error result is the
   * answer, logged as a warning with the permission and the code; a throw is an internal error with a
   * correlation id, reported to the error tracker — so return expected refusals as results, e.g. with
   * platform-files `fileResult`) — what it leaves must be harmless (an unsigned reservation expires and is
   * purged). Never open a transaction of your own here.
   */
  readonly afterCommit?: (args: {
    readonly actor: ActorContext;
    readonly input: z.output<S>;
    readonly result: O;
  }) => Promise<Result<R, AppError>>;
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
 * tenant claim → validate input → [with beforeTransaction: session facts in their own short
 * transaction (inactive → UNAUTHENTICATED), then beforeTransaction, once] → withUserTx {
 *   session facts (inactive → UNAUTHENTICATED) → load effective grants → resolve resource → authorize
 *   (deny by default; AAL2 permissions need the database's AAL2 AND a code from the last
 *   STEP_UP_MAX_AGE_SECONDS, else STEP_UP_REQUIRED) → handler → audit } — the whole transaction run once
 * more after a deadlock or serialization failure, unless the action declares `externalEffects` →
 * [a worker pass requested when the committed attempt queued work: `queuesWork` or an emitted event] →
 * [afterCommit, once, after the commit, no connection held].
 */
export function createDefineAction<Tx>(runtime: ActionRuntime<Tx>) {
  return function defineAction<S extends z.ZodType, O, R = O, B = void>(
    definition: ActionDefinition<S, O, Tx, R, B>,
  ): ServerAction<z.input<S>, R> {
    if (
      definition.passiveRead !== undefined &&
      (definition.audit !== undefined ||
        definition.auditFailure !== undefined ||
        definition.beforeTransaction !== undefined ||
        definition.afterCommit !== undefined ||
        definition.externalEffects === true ||
        definition.queuesWork === true)
    ) {
      throw new Error(
        `defineAction: the passive read ${definition.passiveRead} must only read (no audit, no work before or after its transaction)`,
      );
    }
    // The refused attempt's audit row, in its own transaction (the action's one rolled back).
    const writeFailureAudit = async (
      claims: TenantClaims,
      actor: ActorContext,
      record: AuditRecord | null,
    ): Promise<void> => {
      if (!record) return;
      try {
        await runtime.withUserTx(claims, (tx) => runtime.writeAudit(tx, actor, record));
      } catch (error) {
        runtime.logError(error, {
          permission: definition.permission.code,
          correlationId: newCorrelationId(),
        });
      }
    };
    const action = async (rawInput: z.input<S>): Promise<ActionResult<R>> => {
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

      // A refusal the handler returned (not an authorization denial), for `auditFailure`.
      let refused = null as AppError | null;
      // Did the committed attempt queue background work (declared, or an event emitted)?
      let queued = false as boolean;
      // The key to e-mail the committed attempt's account e-mail requests with, if it queued any.
      let accountMail: unknown = null;
      // beforeTransaction's answer, for the handler.
      let prepared: B | undefined;
      try {
        if (definition.beforeTransaction) {
          // The session check first (integration review T-M2-11 L3), in its own short transaction that
          // ends before beforeTransaction runs (never nested: one pooled connection at a time): a session
          // the database no longer lets act in its organization does no per-actor work either — e.g. it
          // cannot spend the user's password-check budget. The action's transaction checks it again.
          const facts = await runtime.withUserTx(tenantClaims, (tx) =>
            runtime.loadSessionFacts(tx),
          );
          if (!facts.active) return err(toClientError(appError('UNAUTHENTICATED')));
          const before = await definition.beforeTransaction({
            actor: actorFromClaims(tenantClaims),
            input: input.value,
            read: (fn) => runtime.withUserTx(tenantClaims, fn),
          });
          if (!before.ok) return err(toClientError(before.error));
          prepared = before.value;
        }
        const committed = await runtime.withUserTx(
          tenantClaims,
          async (tx) => {
            refused = null; // a retried transaction starts again
            queued = false;
            accountMail = null;
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
              ...(prepared === undefined ? {} : { before: prepared }),
            });
            // Throwing rolls the transaction back.
            if (!output.ok) {
              refused = output.error;
              throw new HandledFailure(output.error);
            }

            const record = definition.audit?.(input.value, output.value);
            if (record) await runtime.writeAudit(tx, actor, record);
            queued = definition.queuesWork === true || (await runtime.queuedWork?.(tx)) === true;
            if (definition.queuesAccountMail === true && runtime.tagInlineAccountMail) {
              accountMail = (await runtime.tagInlineAccountMail(tx)) ?? null;
            }
            return output.value;
          },
          {
            retryOnConflict: definition.externalEffects !== true,
            onRetry: (sqlState) => {
              runtime.logTransactionRetry?.({ permission: definition.permission.code, sqlState });
            },
            ...(definition.passiveRead === undefined
              ? {}
              : { passiveRead: definition.passiveRead }),
          },
        );
        // Committed: queued work gets a worker pass (after the response; never changes the answer).
        if (queued && runtime.requestWorkerPass) {
          try {
            await runtime.requestWorkerPass({ permission: definition.permission.code });
          } catch {
            // Best effort by design: the work is committed and the scheduled pass picks it up.
          }
        }
        // Committed: the account e-mails the action queued go out at once, after the response.
        if (accountMail !== null && runtime.sendInlineAccountMail) {
          try {
            runtime.sendInlineAccountMail(accountMail);
          } catch {
            // Best effort by design: the worker sends them.
          }
        }
        // Without afterCommit the handler's result is the answer (R defaults to O).
        if (!definition.afterCommit) return ok(committed as unknown as R);
        const after = await definition.afterCommit({
          actor: actorFromClaims(tenantClaims),
          input: input.value,
          result: committed,
        });
        if (after.ok) return ok(after.value);
        runtime.logAfterCommitRefusal?.({
          permission: definition.permission.code,
          code: after.error.code,
        });
        return err(toClientError(after.error));
      } catch (error) {
        if (error instanceof HandledFailure) {
          if (refused && definition.auditFailure) {
            const actor = actorFromClaims(tenantClaims);
            await writeFailureAudit(tenantClaims, actor, definition.auditFailure(refused, actor));
          }
          return err(toClientError(error.error));
        }
        // Unexpected: log with a correlation id; the client gets INTERNAL_ERROR + the same id only.
        const correlationId = newCorrelationId();
        runtime.logError(error, { permission: definition.permission.code, correlationId });
        return err(internalError(correlationId));
      }
    };
    return Object.assign(action, { [DEFINE_ACTION_MARKER]: definition.permission.code });
  };
}
