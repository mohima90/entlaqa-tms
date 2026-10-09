import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type MemberLifecycleTarget,
  type ReassignOutcome,
  type ReassignRefusal,
  type ReplacementCandidate,
  type ResponsibilityItem,
  type UserTx,
  deactivateMembership,
  getMemberLifecycleTarget,
  listDirectReports,
  listHeadedDepartments,
  listReplacementCandidates,
  lockMemberLifecycle,
  reactivateMembership,
  reassignDirectReports,
  reassignHeadedDepartments,
  revokePendingInvitationsOf,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionContext, ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import type { PermissionDefinition } from '../permissions';
import { platformPermissions } from '../platform-permissions';

/**
 * Deactivate / reactivate a member (T-M2-09, FR-IAM-05; approved screen 4 «تعطيل المستخدم»). Permission
 * `platform.user.deactivate` (HR Manager, Organization Admin; medium risk, AAL1 — platform permission
 * registry). The database guards repeat the rules: a member who holds a privileged role only by an
 * Organization Admin, never oneself, never the last Organization Admin without an end date. Reactivating a
 * privileged member gives privileged roles back: `platform.role.assign_privileged` — Organization Admin with
 * an authenticator code (AAL2, PO decision D-IAM-01) — checked again inside private.reactivate_membership.
 * Records are kept; roles are kept as they were (screen 4 changes none). Audited with changed facts only:
 * ids, the reason code, what was moved to whom.
 */
const p = platformPermissions;

// ---------------------------------------------------------------------------------------------------
// The reassignment hook
// ---------------------------------------------------------------------------------------------------

/**
 * Something a person is responsible for that needs a new owner before they are deactivated (FR-IAM-05:
 * "prompt reassignment of owned items"). Platform kinds: direct reports, departments they head (T-M2-02
 * decision). Modules add theirs as they ship (M3: upcoming sessions they coordinate; M4: requests waiting
 * for their approval, logistics tasks; …): a kind lists the person's items and moves them all to one new
 * owner, inside the deactivation's transaction (after its locks), through the module's own service — never
 * by reading another module's tables. Compose the kinds in the web app:
 *   defineAction(deactivateMemberActionDefinition([...PLATFORM_RESPONSIBILITIES, ...tmsResponsibilities]))
 * and the same list for deactivationQueryDefinition. Each kind needs the message keys
 * `deactivation.items.<code with "." → "_">.title` (`{count}`, plural) and `….picker` in both languages.
 */
export interface ResponsibilityKind {
  /** Stable code `<module>.<kind>` (audit records, message keys). */
  readonly code: string;
  /**
   * Needed (tenant-wide) to move these items: without it the deactivation is blocked with the reason, and
   * someone who holds it (the Organization Admin) deactivates instead.
   */
  readonly permission: PermissionDefinition;
  /** The person's items now, with whether the signed-in member may move each. */
  readonly list: (tx: UserTx, personId: string) => Promise<readonly ResponsibilityItem[]>;
  /** Moves every item to `toPersonId`; a refusal leaves the transaction to be rolled back. */
  readonly reassign: (
    tx: UserTx,
    fromPersonId: string,
    toPersonId: string,
  ) => Promise<ReassignOutcome>;
}

export const RESPONSIBILITY_CODE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Direct reports get a new direct manager (a placement change: `platform.user.update`). */
export const directReportsResponsibility: ResponsibilityKind = {
  code: 'platform.direct_reports',
  permission: p['platform.user.update'],
  list: (tx, personId) => listDirectReports(tx, personId),
  reassign: (tx, fromPersonId, toPersonId) => reassignDirectReports(tx, fromPersonId, toPersonId),
};

/** Departments get a new head (organization structure: `platform.org.manage`). */
export const headedDepartmentsResponsibility: ResponsibilityKind = {
  code: 'platform.headed_departments',
  permission: p['platform.org.manage'],
  list: (tx, personId) => listHeadedDepartments(tx, personId),
  reassign: (tx, fromPersonId, toPersonId) =>
    reassignHeadedDepartments(tx, fromPersonId, toPersonId),
};

export const PLATFORM_RESPONSIBILITIES: readonly ResponsibilityKind[] = [
  directReportsResponsibility,
  headedDepartmentsResponsibility,
];

/** Kinds are checked once, when the definitions are created: valid, unique codes. */
export function assertResponsibilityKinds(kinds: readonly ResponsibilityKind[]): void {
  const seen = new Set<string>();
  for (const kind of kinds) {
    if (!RESPONSIBILITY_CODE.test(kind.code) || kind.code.length > 100) {
      throw new Error(`responsibility kind "${kind.code}" has an invalid code`);
    }
    if (seen.has(kind.code))
      throw new Error(`responsibility kind "${kind.code}" is registered twice`);
    seen.add(kind.code);
  }
}

// ---------------------------------------------------------------------------------------------------
// The deactivation screen (screen 4)
// ---------------------------------------------------------------------------------------------------

/** Optional reason, recorded in the audit log (screen 4 «سبب التعطيل»). */
export const DEACTIVATION_REASONS = ['end_of_service', 'long_leave', 'transfer', 'other'] as const;
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];

/** Why this person cannot be deactivated here at all. */
export type DeactivationBlock = 'own_account' | 'no_account' | 'not_active' | 'last_admin';
/** Why the actor cannot move a kind of item: the permission, or an item that is not theirs to move. */
export type ResponsibilityBlock = 'permission' | 'item_not_allowed';

export interface ResponsibilityView {
  readonly code: string;
  readonly items: readonly ResponsibilityItem[];
  readonly blocked: ResponsibilityBlock | null;
}

export interface DeactivationView {
  readonly target: {
    readonly personId: string;
    readonly displayNameAr: string;
    readonly displayNameEn: string | null;
  };
  readonly blocked: DeactivationBlock | null;
  /** The kinds the person holds items of (empty: nothing to move). */
  readonly responsibilities: readonly ResponsibilityView[];
  /** Who can take them over (empty when there is nothing to move). */
  readonly candidates: readonly ReplacementCandidate[];
}

export function deactivationBlock(target: MemberLifecycleTarget): DeactivationBlock | null {
  if (target.isSelf) return 'own_account';
  if (target.membershipId === null) return 'no_account';
  if (target.membershipStatus !== 'active') return 'not_active';
  if (target.lastAdmin) return 'last_admin';
  return null;
}

async function responsibilitiesOf(
  ctx: ActionContext<UserTx>,
  kinds: readonly ResponsibilityKind[],
  personId: string,
): Promise<ResponsibilityView[]> {
  const views: ResponsibilityView[] = [];
  for (const kind of kinds) {
    const items = await kind.list(ctx.tx, personId);
    if (items.length === 0) continue;
    const blocked: ResponsibilityBlock | null = !ctx.can(kind.permission, 'tenant')
      ? 'permission'
      : items.some((item) => !item.movable)
        ? 'item_not_allowed'
        : null;
    views.push({ code: kind.code, items, blocked });
  }
  return views;
}

export const DeactivationQueryInput = z.strictObject({ personId: z.uuid() });

/**
 * What screen 4 shows: the person, why they cannot be deactivated (if so), what they are responsible for
 * and who can take it over. Out of scope or another organization → NOT_FOUND; a privileged member for an
 * HR Manager → FORBIDDEN (the guards' rule).
 */
export function deactivationQueryDefinition(
  kinds: readonly ResponsibilityKind[] = PLATFORM_RESPONSIBILITIES,
): QueryDefinition<typeof DeactivationQueryInput, DeactivationView, UserTx> {
  assertResponsibilityKinds(kinds);
  return {
    permission: p['platform.user.deactivate'],
    input: DeactivationQueryInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const target = await getMemberLifecycleTarget(ctx.tx, input.personId);
      if (!target) return err(appError('NOT_FOUND'));
      const blocked = deactivationBlock(target);
      if (blocked === null && !target.mayManage) return err(appError('FORBIDDEN'));
      const view = {
        target: {
          personId: target.personId,
          displayNameAr: target.displayNameAr,
          displayNameEn: target.displayNameEn,
        },
        blocked,
      };
      if (blocked) return ok({ ...view, responsibilities: [], candidates: [] });
      const responsibilities = await responsibilitiesOf(ctx, kinds, input.personId);
      const candidates =
        responsibilities.length > 0 ? await listReplacementCandidates(ctx.tx, input.personId) : [];
      return ok({ ...view, responsibilities, candidates });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------------------------------

export const DeactivateMemberInput = z
  .strictObject({
    personId: z.uuid(),
    reason: z
      .union([z.enum(DEACTIVATION_REASONS), z.literal('')])
      .transform((value) => (value === '' ? null : value)),
    /** The new owner per kind of item («نقل الكل إلى» fills every kind with one person). */
    reassign: z
      .array(
        z.strictObject({
          kind: z.string().max(100).regex(RESPONSIBILITY_CODE),
          toPersonId: z.uuid(),
        }),
      )
      .max(20),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.reassign.forEach((choice, index) => {
      if (seen.has(choice.kind)) {
        ctx.addIssue({ code: 'custom', path: ['reassign', index, 'kind'], message: 'twice' });
      }
      seen.add(choice.kind);
    });
  });

export interface Reassignment {
  readonly kind: string;
  readonly toPersonId: string;
  /** Ids of what was moved (people, departments, …). */
  readonly ids: readonly string[];
}

export interface MemberDeactivated {
  readonly personId: string;
  readonly membershipId: string;
  readonly reason: DeactivationReason | null;
  readonly reassigned: readonly Reassignment[];
  readonly invitationsRevoked: readonly string[];
}

/** Field error codes of a refused reassignment (path `reassign.<kind code>`). */
const REASSIGN_CODES: Record<ReassignRefusal, string> = {
  not_allowed: 'NOT_ALLOWED',
  owner_invalid: 'OWNER_INVALID',
  owner_reports_to_person: 'OWNER_REPORTS_TO_PERSON',
};

function fieldError(path: string, code: string): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

/** A DomainError of the invitation helpers (e.g. ROLE_NOT_ALLOWED), read from its `code`. */
function domainCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Deactivates a member (screen 4 «نقل العناصر وتعطيل الحساب»), in one transaction: takes the locks, checks
 * the person again, moves every kind of item they are responsible for to the chosen owner, revokes their
 * pending invitations, then makes the person inactive and the membership `suspended` (their sessions in
 * this organization end; the Auth ban follows from the worker). A kind is refused on the field
 * `reassign.<code>`: OWNER_REQUIRED (no owner chosen — e.g. the person took something on after the page was
 * loaded), NOT_ALLOWED, OWNER_INVALID or OWNER_REPORTS_TO_PERSON.
 */
export function deactivateMemberActionDefinition(
  kinds: readonly ResponsibilityKind[] = PLATFORM_RESPONSIBILITIES,
): ActionDefinition<typeof DeactivateMemberInput, MemberDeactivated, UserTx> {
  assertResponsibilityKinds(kinds);
  const known = new Set(kinds.map((kind) => kind.code));
  return {
    permission: p['platform.user.deactivate'],
    input: DeactivateMemberInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const unknown = input.reassign.findIndex((choice) => !known.has(choice.kind));
      if (unknown >= 0) return err(fieldError(`reassign.${String(unknown)}.kind`, 'UNKNOWN'));
      // Serialised with every change of managers, heads, roles and memberships (global lock order).
      await lockMemberLifecycle(ctx.tx);
      const target = await getMemberLifecycleTarget(ctx.tx, input.personId);
      if (target?.membershipId == null) return err(appError('NOT_FOUND'));
      if (target.isSelf || !target.mayManage) return err(appError('FORBIDDEN'));
      if (target.membershipStatus !== 'active') return err(fieldError('personId', 'NOT_ACTIVE'));
      if (target.lastAdmin) return err(fieldError('personId', 'LAST_ADMIN'));

      const reassigned: Reassignment[] = [];
      for (const kind of kinds) {
        const items = await kind.list(ctx.tx, input.personId);
        if (items.length === 0) continue;
        const path = `reassign.${kind.code}`;
        if (!ctx.can(kind.permission, 'tenant') || items.some((item) => !item.movable)) {
          return err(fieldError(path, 'NOT_ALLOWED'));
        }
        const choice = input.reassign.find((c) => c.kind === kind.code);
        if (!choice) return err(fieldError(path, 'OWNER_REQUIRED'));
        const outcome = await kind.reassign(ctx.tx, input.personId, choice.toPersonId);
        if (!outcome.ok) return err(fieldError(path, REASSIGN_CODES[outcome.refusal]));
        reassigned.push({ kind: kind.code, toPersonId: choice.toPersonId, ids: outcome.moved });
      }

      let invitationsRevoked: readonly string[];
      try {
        invitationsRevoked = await revokePendingInvitationsOf(ctx.tx, input.personId);
      } catch (error) {
        if (domainCode(error) === 'ROLE_NOT_ALLOWED') return err(appError('FORBIDDEN'));
        throw error;
      }

      const outcome = await deactivateMembership(ctx.tx, {
        personId: input.personId,
        membershipId: target.membershipId,
      });
      if (!outcome.ok) {
        if (outcome.refusal === 'not_allowed') return err(appError('FORBIDDEN'));
        return err(
          fieldError('personId', outcome.refusal === 'last_admin' ? 'LAST_ADMIN' : 'NOT_ACTIVE'),
        );
      }
      return ok({
        personId: input.personId,
        membershipId: target.membershipId,
        reason: input.reason,
        reassigned,
        invitationsRevoked,
      });
    },
    audit: (_input, output) => ({
      action: 'platform.user.deactivated',
      entityType: 'person',
      entityId: output.personId,
      // Changed facts only (ids and codes; no names): the membership suspended, the reason, what moved to
      // whom (FR-IAM-05 "reassignment of owned items audited"), the invitations revoked.
      data: {
        membershipId: output.membershipId,
        ...(output.reason ? { reason: output.reason } : {}),
        reassigned: output.reassigned,
        invitationsRevoked: output.invitationsRevoked,
      },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Reactivate
// ---------------------------------------------------------------------------------------------------

export const ReactivateMemberInput = z.strictObject({ personId: z.uuid() });

export interface MemberReactivated {
  readonly personId: string;
  readonly membershipId: string;
}

function reactivateAction(
  permission: PermissionDefinition,
  privileged: boolean,
): ActionDefinition<typeof ReactivateMemberInput, MemberReactivated, UserTx> {
  return {
    permission,
    input: ReactivateMemberInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      // The privileged path is authorized by role.assign_privileged; reactivating stays user.deactivate.
      if (privileged && !ctx.can(p['platform.user.deactivate'], ctx.resource ?? 'tenant')) {
        return err(appError('FORBIDDEN'));
      }
      // No lock up front: the person update takes the departments and branches locks, then the database
      // function the role lock (global order departments → branches → person_employment → roles).
      const target = await getMemberLifecycleTarget(ctx.tx, input.personId);
      if (target?.membershipId == null) return err(appError('NOT_FOUND'));
      if (target.isSelf || !target.mayManage) return err(appError('FORBIDDEN'));
      if (target.membershipStatus !== 'suspended') {
        return err(fieldError('personId', 'NOT_DEACTIVATED'));
      }
      if (target.privileged && !privileged) {
        // Ordinary path: a privileged member comes back through the privileged action (AAL2, strict check).
        const access = ctx.access(p['platform.role.assign_privileged'], ctx.resource ?? 'tenant');
        return err(appError(access === 'step_up_required' ? 'STEP_UP_REQUIRED' : 'FORBIDDEN'));
      }
      const outcome = await reactivateMembership(ctx.tx, input.personId);
      if (!outcome.ok) {
        switch (outcome.refusal) {
          case 'not_found':
            return err(appError('NOT_FOUND'));
          case 'not_deactivated':
            return err(fieldError('personId', 'NOT_DEACTIVATED'));
          case 'placement_deleted':
            return err(fieldError('personId', 'PLACEMENT_DELETED'));
          case 'step_up_required':
            return err(appError('STEP_UP_REQUIRED'));
          case 'not_allowed':
            return err(appError('FORBIDDEN'));
        }
      }
      return ok({ personId: input.personId, membershipId: outcome.membershipId });
    },
    audit: (_input, output) => ({
      action: 'platform.user.reactivated',
      entityType: 'person',
      entityId: output.personId,
      data: { membershipId: output.membershipId },
    }),
  };
}

/** Members without a privileged role (HR Manager, Organization Admin). */
export function reactivateMemberActionDefinition() {
  return reactivateAction(p['platform.user.deactivate'], false);
}

/** Members who hold a privileged role: Organization Admin with an authenticator code (AAL2). */
export function reactivatePrivilegedMemberActionDefinition() {
  return reactivateAction(p['platform.role.assign_privileged'], true);
}

// ---------------------------------------------------------------------------------------------------
// What the profile offers (screen 3 «تعطيل المستخدم», «إعادة تفعيل المستخدم»)
// ---------------------------------------------------------------------------------------------------

export interface LifecycleOffer {
  /** «تعطيل المستخدم»: an active member the signed-in member may manage (not themselves). */
  readonly canDeactivate: boolean;
  /** «إعادة تفعيل المستخدم»: allowed now, after an authenticator code, or not offered (null). */
  readonly reactivate: 'allowed' | 'step_up_required' | null;
  /** The member holds a privileged role: reactivation goes through the privileged action. */
  readonly privileged: boolean;
}

export const NO_LIFECYCLE_OFFER: LifecycleOffer = {
  canDeactivate: false,
  reactivate: null,
  privileged: false,
};

/** Called by queries that authorized the person resource and hold `platform.user.deactivate` for it. */
export async function lifecycleOffer(
  ctx: ActionContext<UserTx>,
  personId: string,
): Promise<LifecycleOffer> {
  const target = await getMemberLifecycleTarget(ctx.tx, personId);
  if (!target || target.isSelf || !target.mayManage) return NO_LIFECYCLE_OFFER;
  let reactivate: LifecycleOffer['reactivate'] = null;
  if (target.membershipStatus === 'suspended') {
    const access = target.privileged
      ? ctx.access(p['platform.role.assign_privileged'], ctx.resource ?? 'tenant')
      : 'allowed';
    reactivate = access === 'denied' ? null : access;
  }
  return {
    canDeactivate: target.membershipStatus === 'active',
    reactivate,
    privileged: target.privileged,
  };
}
