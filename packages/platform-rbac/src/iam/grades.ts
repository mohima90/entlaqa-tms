import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type GradeRefusal,
  type GradeRow,
  type UserTx,
  createGrade,
  deleteGrade,
  listGradesWithPeople,
  renameGrade,
} from '@jadarat/platform-db';
import { normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';

/**
 * Grades (WP-ADM-04, FR-IAM-01 grade; business flow EP-PEOPLE-photo-hr-fields, PO answers 21 and 23 Oct
 * 2026): the organization's list of grade codes (7, G7, #7, G-7 …), unique in the organization, managed on
 * the «Grades» page under Organization by the HR Manager and the Organization Admin — `platform.user.update`
 * organization-wide, which both hold (a custom role may too; «manage grades» as its own permission is parked).
 * The database repeats every rule (platform.grades: code check, unique ignoring case, a grade people hold is
 * not deleted — JG001, write policies). Every change is audited (codes only).
 */
const p = platformPermissions;

/**
 * A grade code as typed: digits in any script become Latin, surrounding spaces go; 1-12 characters, no
 * spaces inside, at least one letter or digit. The database holds the same rule.
 */
export const GradeCode = z
  .string()
  .max(60)
  .transform((value) => normalizeDigits(value).trim())
  .pipe(
    z
      .string()
      .min(1, 'required')
      .max(12, 'format')
      // No spaces, control or invisible formatting characters; at least one letter or digit.
      .refine((value) => !/[\s\p{Cc}\p{Cf}]/u.test(value), 'format')
      .refine((value) => /[\p{L}\p{N}]/u.test(value), 'format'),
  );

export interface GradesPageView {
  readonly grades: readonly GradeRow[];
}

export function gradesPageQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  GradesPageView,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: z.strictObject({}),
    handler: async ({ ctx }) => ok({ grades: await listGradesWithPeople(ctx.tx) }),
  };
}

function refusalError(refusal: GradeRefusal): AppError {
  const field = (path: string, code: string) =>
    appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
  switch (refusal) {
    case 'taken':
      return field('code', 'TAKEN');
    case 'invalid':
      return field('code', 'FORMAT');
    case 'in_use':
      return field('id', 'IN_USE');
    case 'not_found':
      return appError('NOT_FOUND');
    case 'not_allowed':
      return appError('FORBIDDEN');
  }
}

export const AddGradeInput = z.strictObject({ code: GradeCode });
export const RenameGradeInput = z.strictObject({ id: z.uuid(), code: GradeCode });
export const DeleteGradeInput = z.strictObject({ id: z.uuid() });

export interface GradeAdded {
  readonly id: string;
  readonly code: string;
}

export function addGradeActionDefinition(): ActionDefinition<
  typeof AddGradeInput,
  GradeAdded,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: AddGradeInput,
    handler: async ({ ctx, input }) => {
      const created = await createGrade(ctx.tx, input.code);
      if (!created.ok) return err(refusalError(created.refusal));
      return ok({ id: created.id, code: created.code });
    },
    audit: (_input, output) => ({
      action: 'platform.grade.created',
      entityType: 'grade',
      entityId: output.id,
      data: { code: output.code },
    }),
  };
}

export interface GradeRenamed {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** People on the grade: they show the new code. */
  readonly people: number;
}

export function renameGradeActionDefinition(): ActionDefinition<
  typeof RenameGradeInput,
  GradeRenamed,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: RenameGradeInput,
    handler: async ({ ctx, input }) => {
      const renamed = await renameGrade(ctx.tx, input.id, input.code);
      if (!renamed.ok) return err(refusalError(renamed.refusal));
      return ok({ id: input.id, from: renamed.from, to: renamed.to, people: renamed.people });
    },
    audit: (_input, output) =>
      output.from === output.to
        ? null
        : {
            action: 'platform.grade.renamed',
            entityType: 'grade',
            entityId: output.id,
            data: { from: output.from, to: output.to },
          },
  };
}

export interface GradeDeleted {
  readonly id: string;
  readonly code: string;
}

export function deleteGradeActionDefinition(): ActionDefinition<
  typeof DeleteGradeInput,
  GradeDeleted,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: DeleteGradeInput,
    handler: async ({ ctx, input }) => {
      const deleted = await deleteGrade(ctx.tx, input.id);
      if (!deleted.ok) return err(refusalError(deleted.refusal));
      return ok({ id: input.id, code: deleted.code });
    },
    audit: (_input, output) => ({
      action: 'platform.grade.deleted',
      entityType: 'grade',
      entityId: output.id,
      data: { code: output.code },
    }),
  };
}
