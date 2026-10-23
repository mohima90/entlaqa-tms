import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type GradeChange,
  type GradeOption,
  type HrDetails,
  type HrField,
  type UserTx,
  getHrDetails,
  getPersonGrade,
  insertAuditEvent,
  listGrades,
  saveHrDetails,
  setPersonGrade,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionContext, ActionDefinition } from '../define-action';
import { platformPermissions } from '../platform-permissions';

/**
 * A person's grade and HR-only fields (WP-ADM-04, FR-IAM-01, FR-IAM-02; business flow
 * EP-PEOPLE-photo-hr-fields, PO answers 21 and 23 Oct 2026).
 *
 *   - Grade: one code of the organization's list (platform.grades), set by the HR Manager and the
 *     Organization Admin (`platform.user.update`) — also for a privileged member, whose account details they
 *     cannot change (BR-PPL-f). Seen by those two, the person, the managers above them and the heads of their
 *     unit: the DATABASE gives nobody else the row (platform.person_grades).
 *   - HR-only fields (gender, date of birth, employment category): `platform.person.hr_details` — the HR
 *     Manager and custom roles given it, NEVER the Organization Admin — and read-only for the person
 *     themself. The card is not rendered for anyone else and nothing is sent to their browser: the database
 *     returns no row and the view carries `null` (platform.person_hr_details).
 * Audit: grade changes with the codes; HR-only changes with the FIELD NAMES and the value «hidden» (BR-PPL-i).
 */
const p = platformPermissions;

/** The fixed lists of R1 (mirrors platform-db GENDERS / EMPLOYMENT_CATEGORIES; a unit test keeps them equal). */
export const GENDERS = ['male', 'female'] as const;
export const EMPLOYMENT_CATEGORIES = [
  'management',
  'professional',
  'technical',
  'operational',
] as const;
const EMPTY_HR_DETAILS: HrDetails = { gender: null, birthDate: null, employmentCategory: null };

/** The grade section of a person's page as the viewer may see it (null: not for this viewer). */
export interface GradeSection {
  /** The code, or null: none (HR / the Organization Admin / the person themself are told «No grade»). */
  readonly code: string | null;
}

/** The HR-only card of a person's page: null = not for this viewer, nothing is rendered or sent. */
export interface HrSection {
  /** Null: HR has not filled them yet. */
  readonly details: HrDetails | null;
  /** The viewer is the person themself: read-only «Ask HR to correct these». */
  readonly own: boolean;
}

export interface PersonRecordView {
  readonly grade: GradeSection | null;
  readonly hr: HrSection | null;
}

type Ctx = Pick<ActionContext<UserTx>, 'tx' | 'actor' | 'can'>;

/**
 * The grade and HR sections of a person for the viewer (page of the person, My profile). The database is
 * the authority on who may see a row; this decides what an empty answer means («none» or «not for you»).
 */
export async function loadPersonRecordView(ctx: Ctx, personId: string): Promise<PersonRecordView> {
  const own = ctx.actor.personId === personId;
  const managesGrades = ctx.can(p['platform.user.update'], 'tenant');
  const holdsHr = ctx.can(p['platform.person.hr_details'], 'tenant');
  const grade = await getPersonGrade(ctx.tx, personId);
  const hr = own || holdsHr ? await getHrDetails(ctx.tx, personId) : null;
  return {
    grade: grade !== null ? { code: grade.code } : own || managesGrades ? { code: null } : null,
    hr: own || holdsHr ? { details: hr, own } : null,
  };
}

/** The edit panel's choices: the grade list and the person's grade; the HR fields only for who may edit them. */
export interface PersonRecordEdit {
  readonly gradeId: string | null;
  readonly grades: readonly GradeOption[];
  /** Null: the viewer does not hold platform.person.hr_details — no card. */
  readonly hr: HrDetails | null;
  readonly canEditHr: boolean;
}

export async function loadPersonRecordEdit(ctx: Ctx, personId: string): Promise<PersonRecordEdit> {
  const canEditHr = ctx.can(p['platform.person.hr_details'], 'tenant');
  const grade = await getPersonGrade(ctx.tx, personId);
  return {
    gradeId: grade?.id ?? null,
    grades: await listGrades(ctx.tx),
    hr: canEditHr ? ((await getHrDetails(ctx.tx, personId)) ?? EMPTY_HR_DETAILS) : null,
    canEditHr,
  };
}

// ---------------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------------

const optional = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.literal('')])
    .transform((value) => (value === '' ? null : (value as z.output<T>)));

export const HrDetailsInput = z.strictObject({
  gender: optional(z.enum(GENDERS)),
  // A real date; «in the past» is the database's rule (checked when written).
  birthDate: optional(
    z.iso
      .date()
      .refine((value) => value >= '1900-01-01' && value <= '2100-12-31', { message: 'range' }),
  ),
  employmentCategory: optional(z.enum(EMPLOYMENT_CATEGORIES)),
});

export const UpdatePersonRecordInput = z.strictObject({
  personId: z.uuid(),
  /** A grade of the list; '' clears it; absent: the grade is not part of this save. */
  gradeId: optional(z.uuid()).optional(),
  /** The HR-only fields; absent: not part of this save (the viewer may not hold the permission). */
  hr: HrDetailsInput.optional(),
});

export interface PersonRecordSaved {
  readonly personId: string;
  /** Null: the grade was not part of the save. */
  readonly grade: GradeChange | null;
  /** Names of the changed HR-only fields (never values). */
  readonly hrChanged: readonly HrField[];
}

const field = (path: string, code: string): AppError =>
  appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });

export function updatePersonRecordActionDefinition(): ActionDefinition<
  typeof UpdatePersonRecordInput,
  PersonRecordSaved,
  UserTx
> {
  return {
    permission: p['platform.user.update'],
    input: UpdatePersonRecordInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      let grade: GradeChange | null = null;
      if (input.gradeId !== undefined) {
        const set = await setPersonGrade(ctx.tx, input.personId, input.gradeId);
        if (!set.ok) {
          return err(
            set.refusal === 'invalid' ? field('gradeId', 'INVALID') : appError('FORBIDDEN'),
          );
        }
        grade = set.change;
        if (grade.changed) {
          await insertAuditEvent(ctx.tx, ctx.actor, {
            action: 'platform.person.grade_changed',
            entityType: 'person',
            entityId: input.personId,
            data: { from: grade.from, to: grade.to },
          });
        }
      }
      let hrChanged: readonly HrField[] = [];
      if (input.hr !== undefined) {
        // Never the Organization Admin: only a member holding the HR-only permission organization-wide.
        if (!ctx.can(p['platform.person.hr_details'], 'tenant')) return err(appError('FORBIDDEN'));
        const saved = await saveHrDetails(ctx.tx, input.personId, input.hr);
        if (!saved.ok) {
          if (saved.refusal === 'birth_date_invalid') return err(field('birthDate', 'INVALID'));
          return err(appError(saved.refusal === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN'));
        }
        hrChanged = saved.changed;
      }
      return ok({ personId: input.personId, grade, hrChanged });
    },
    audit: auditHrChanges,
  };
}

// HR-only changes: the field names and «hidden» — never a value (BR-PPL-i, EP-AUD BR-AUD-f).
function auditHrChanges(_input: unknown, output: PersonRecordSaved) {
  return output.hrChanged.length === 0
    ? null
    : {
        action: 'platform.person.hr_details_changed',
        entityType: 'person',
        entityId: output.personId,
        data: { changed: output.hrChanged, value: 'hidden' },
      };
}

export const UpdatePersonHrDetailsInput = z.strictObject({
  personId: z.uuid(),
  hr: HrDetailsInput,
});

/**
 * Saves ONLY the HR-only fields, for a member who holds `platform.person.hr_details` alone (a custom role
 * without `platform.user.update`; security review L3). The grade and the account details stay behind
 * `platform.user.update` (updatePersonRecordActionDefinition). The database policy is the same check.
 */
export function updatePersonHrDetailsActionDefinition(): ActionDefinition<
  typeof UpdatePersonHrDetailsInput,
  PersonRecordSaved,
  UserTx
> {
  return {
    permission: p['platform.person.hr_details'],
    input: UpdatePersonHrDetailsInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const saved = await saveHrDetails(ctx.tx, input.personId, input.hr);
      if (!saved.ok) {
        if (saved.refusal === 'birth_date_invalid') return err(field('birthDate', 'INVALID'));
        return err(appError(saved.refusal === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN'));
      }
      return ok({ personId: input.personId, grade: null, hrChanged: saved.changed });
    },
    audit: auditHrChanges,
  };
}
