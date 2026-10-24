import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type CostCentreOption,
  type EditableUser,
  type ManagerOption,
  type OrgUnitOptions,
  type StructureLevelLabel,
  type UserDetailsRefusal,
  type UserTx,
  getEditableUser,
  getTenantDefaultLocale,
  listCostCentreOptions,
  listManagerOptions,
  listOrgUnitOptions,
  listStructureLevelLabels,
  updateUserDetails,
} from '@jadarat/platform-db';
import { hasVisibleText, normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';
import { mobile, namePart, nameRuleError } from './my-profile';
import { type PersonRecordEdit, loadPersonRecordEdit } from './person-record';

/**
 * HR / Organization Admin edits of a person's details and placement (T-M2-13, FR-IAM-01, BR-IAM-3;
 * fields of the approved screen 2). Permission `platform.user.update` on the person; a privileged
 * member's record only by an Organization Admin (private.actor_may_manage_person, same rule as the
 * database guard). The login e-mail of a member with an account is not changed here.
 */
const p = platformPermissions;

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .transform((value) => (value === '' ? null : value));

const jobTitle = z
  .string()
  .trim()
  .max(150)
  .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
  .transform((value) => (value === '' ? null : value));

export const EditUserInput = z
  .strictObject({
    personId: z.uuid(),
    version: z.string().regex(/^[0-9]{1,9}:[0-9]{1,9}$/),
    // The organization's default language's first and family names are required (guided-test feedback #2,
    // PO 17 Oct 2026), unless that name is stored without parts and kept as is (checked when saving).
    firstNameAr: namePart,
    fatherNameAr: namePart,
    grandfatherNameAr: namePart,
    familyNameAr: namePart,
    firstNameEn: namePart,
    fatherNameEn: namePart,
    grandfatherNameEn: namePart,
    familyNameEn: namePart,
    email: z
      .union([z.email().max(254), z.literal('')])
      .transform((value) => (value === '' ? null : value.toLowerCase())),
    mobile,
    employeeNumber: z
      .string()
      .max(40)
      .transform((value) => normalizeDigits(value).trim())
      .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
      .transform((value) => (value === '' ? null : value)),
    preferredLocale: z.enum(['ar', 'en']),
    departmentId: optionalId,
    branchId: optionalId,
    managerPersonId: optionalId,
    jobTitleAr: jobTitle,
    jobTitleEn: jobTitle,
    hireOn: z
      .union([
        z.iso.date().refine((value) => value >= '1900-01-01' && value <= '2100-12-31', {
          message: 'range',
        }),
        z.literal(''),
      ])
      .transform((value) => (value === '' ? null : value)),
    // The person's one cost centre (WP-HR-01). Absent (a page opened before the change): kept as it is.
    costCentreId: optionalId.optional(),
  })
  .superRefine((value, ctx) => {
    const length = (...parts: (string | null)[]) =>
      parts.filter((part) => part !== null).join(' ').length;
    if (
      length(value.firstNameAr, value.fatherNameAr, value.grandfatherNameAr, value.familyNameAr) >
      200
    ) {
      ctx.addIssue({ code: 'custom', path: ['firstNameAr'], message: 'too_long' });
    }
    if (
      length(value.firstNameEn, value.fatherNameEn, value.grandfatherNameEn, value.familyNameEn) >
      200
    ) {
      ctx.addIssue({ code: 'custom', path: ['firstNameEn'], message: 'too_long' });
    }
    if (value.managerPersonId !== null && value.managerPersonId === value.personId) {
      ctx.addIssue({ code: 'custom', path: ['managerPersonId'], message: 'self' });
    }
  });

export interface EditUserView {
  readonly user: EditableUser;
  readonly managers: readonly ManagerOption[];
  readonly orgUnits: OrgUnitOptions;
  /**
   * The organization's own level names (FR-ADM-05): unit fields and columns say them instead of a fixed
   * «Department» (guided-test feedback #3, PO 17 Oct 2026). One read per page.
   */
  readonly levels: readonly StructureLevelLabel[];
  /**
   * The record is a privileged member's and the viewer is not an Organization Admin (WP-ADM-04, BR-PPL-f):
   * the account details stay locked, but HR still fills the grade and the HR-only fields.
   */
  readonly locked: boolean;
  /** The grade list and grade of the person, and the HR-only fields for who may edit them. */
  readonly record: PersonRecordEdit;
  /** The organization's cost centres (the form offers the active ones; WP-HR-01). */
  readonly costCentres: readonly CostCentreOption[];
}

export const EditUserQueryInput = z.strictObject({ personId: z.uuid() });

export function editUserQueryDefinition(): QueryDefinition<
  typeof EditUserQueryInput,
  EditUserView,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: EditUserQueryInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const user = await getEditableUser(ctx.tx, input.personId);
      if (!user) return err(appError('NOT_FOUND'));
      const record = await loadPersonRecordEdit(ctx, input.personId);
      // A privileged member's account details: Organization Admin only (same rule as the database guard).
      // HR may still open the record to fill the HR-only fields and the grade (WP-ADM-04, BR-PPL-f).
      if (!user.mayManage && !record.canEditHr) return err(appError('FORBIDDEN'));
      const managers = await listManagerOptions(ctx.tx, user.managerPersonId);
      const orgUnits = await listOrgUnitOptions(ctx.tx);
      return ok({
        user,
        managers: managers.filter((m) => m.personId !== user.personId),
        orgUnits,
        levels: await listStructureLevelLabels(ctx.tx),
        locked: !user.mayManage,
        record,
        costCentres: await listCostCentreOptions(ctx.tx),
      });
    },
  };
}

/** Database refusals → errors the form can show next to the right field. */
function refusalError(refusal: UserDetailsRefusal, nameLanguage: 'ar' | 'en'): AppError {
  const field = (path: string, code: string) =>
    appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
  switch (refusal) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'not_allowed':
      return appError('FORBIDDEN');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'email_taken':
      return field('email', 'TAKEN');
    case 'employee_number_taken':
      return field('employeeNumber', 'TAKEN');
    case 'manager_loop':
      return field('managerPersonId', 'LOOP');
    case 'manager_inactive':
      return field('managerPersonId', 'INACTIVE');
    case 'department_deleted':
      return field('departmentId', 'DELETED');
    case 'branch_deleted':
      return field('branchId', 'DELETED');
    case 'hire_date_invalid':
      return field('hireOn', 'AFTER_END');
    case 'name_required':
      return field(nameLanguage === 'ar' ? 'firstNameAr' : 'firstNameEn', 'REQUIRED');
    case 'cost_centre_inactive':
      return field('costCentreId', 'INACTIVE');
  }
}

export interface UserDetailsSaved {
  readonly personId: string;
  /** Changed field names (no values: personal data stays out of the audit log). */
  readonly changed: readonly string[];
}

export function updateUserDetailsActionDefinition(): ActionDefinition<
  typeof EditUserInput,
  UserDetailsSaved,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: EditUserInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const before = await getEditableUser(ctx.tx, input.personId);
      if (before?.mayManage) {
        const nameProblem = await nameRuleError(ctx.tx, input, { before, next: input });
        if (nameProblem) return err(nameProblem);
      }
      const join = (...parts: (string | null)[]) =>
        parts.filter((part): part is string => part !== null).join(' ');
      const displayNameEn = join(
        input.firstNameEn,
        input.fatherNameEn,
        input.grandfatherNameEn,
        input.familyNameEn,
      );
      const outcome = await updateUserDetails(ctx.tx, input.personId, input.version, {
        firstNameAr: input.firstNameAr,
        fatherNameAr: input.fatherNameAr,
        grandfatherNameAr: input.grandfatherNameAr,
        familyNameAr: input.familyNameAr,
        firstNameEn: input.firstNameEn,
        fatherNameEn: input.fatherNameEn,
        grandfatherNameEn: input.grandfatherNameEn,
        familyNameEn: input.familyNameEn,
        displayNameAr:
          join(
            input.firstNameAr,
            input.fatherNameAr,
            input.grandfatherNameAr,
            input.familyNameAr,
          ) || null,
        displayNameEn: displayNameEn === '' ? null : displayNameEn,
        email: input.email,
        mobileE164: input.mobile,
        employeeNumber: input.employeeNumber,
        preferredLocale: input.preferredLocale,
        departmentId: input.departmentId,
        branchId: input.branchId,
        managerPersonId: input.managerPersonId,
        jobTitleAr: input.jobTitleAr,
        jobTitleEn: input.jobTitleEn,
        hireOn: input.hireOn,
        costCentreId:
          input.costCentreId === undefined ? (before?.costCentreId ?? null) : input.costCentreId,
      });
      if (!outcome.ok) {
        return err(refusalError(outcome.refusal, await getTenantDefaultLocale(ctx.tx)));
      }
      return ok({ personId: input.personId, changed: outcome.changed });
    },
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.user.updated',
            entityType: 'person',
            entityId: output.personId,
            data: { changed: output.changed },
          },
  };
}
