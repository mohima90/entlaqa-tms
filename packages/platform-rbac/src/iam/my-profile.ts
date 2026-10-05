import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  type PersonalDetails,
  type UserProfile,
  type UserTx,
  getPersonalDetails,
  getUserProfile,
  updatePersonalDetails,
} from '@jadarat/platform-db';
import { hasVisibleText, normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { memberPermissions } from '../member-permissions';

/**
 * My profile (FR-IAM-16, PO decision 5 Oct 2026): every member reads their own profile and changes
 * their own personal details and password. E-mail and job data stay read-only (changed by HR).
 * The database refuses any other column on one's own record (private.check_person_writer).
 */
const manageOwn = memberPermissions['platform.profile.manage_own'];

const namePart = z
  .string()
  .trim()
  .max(60)
  .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
  .transform((value) => (value === '' ? null : value));

/** Mobile with country code: digits in any script, spaces/dashes/brackets ignored, 00 → +. */
const mobile = z
  .string()
  .max(32)
  .transform((value) => {
    const compact = normalizeDigits(value).replace(/[\s\-().]/g, '');
    return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  })
  .refine((value) => value === '' || /^\+[1-9][0-9]{6,14}$/.test(value), {
    message: 'mobile_e164',
  })
  .transform((value) => (value === '' ? null : value));

export const MyProfileInput = z.strictObject({
  firstNameAr: namePart.refine((v) => v !== null, { message: 'required' }),
  fatherNameAr: namePart,
  grandfatherNameAr: namePart,
  familyNameAr: namePart.refine((v) => v !== null, { message: 'required' }),
  firstNameEn: namePart,
  fatherNameEn: namePart,
  grandfatherNameEn: namePart,
  familyNameEn: namePart,
  mobile,
  preferredLocale: z.enum(['ar', 'en']),
});

/** Display names composed from the parts (design principles §4); English only when given. */
export function personalDetailsFrom(input: z.output<typeof MyProfileInput>): PersonalDetails {
  const join = (...parts: (string | null)[]) =>
    parts.filter((p): p is string => p !== null).join(' ');
  const displayNameEn = join(
    input.firstNameEn,
    input.fatherNameEn,
    input.grandfatherNameEn,
    input.familyNameEn,
  );
  return {
    firstNameAr: input.firstNameAr,
    fatherNameAr: input.fatherNameAr,
    grandfatherNameAr: input.grandfatherNameAr,
    familyNameAr: input.familyNameAr,
    firstNameEn: input.firstNameEn,
    fatherNameEn: input.fatherNameEn,
    grandfatherNameEn: input.grandfatherNameEn,
    familyNameEn: input.familyNameEn,
    displayNameAr: join(
      input.firstNameAr,
      input.fatherNameAr,
      input.grandfatherNameAr,
      input.familyNameAr,
    ),
    displayNameEn: displayNameEn === '' ? null : displayNameEn,
    mobileE164: input.mobile,
    preferredLocale: input.preferredLocale,
  };
}

export interface MyProfileView {
  readonly details: PersonalDetails;
  /** Job data and e-mail, read-only on My profile. */
  readonly profile: UserProfile;
}

export function myProfileQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  MyProfileView,
  UserTx
> {
  return {
    permission: manageOwn,
    input: z.strictObject({}),
    scoped: true, // the handler touches only the member's own person
    handler: async ({ ctx }) => {
      const personId = ctx.actor.personId;
      if (!personId) return err(appError('NOT_FOUND'));
      const details = await getPersonalDetails(ctx.tx, personId);
      const profile = await getUserProfile(ctx.tx, personId, {
        includeRoles: false,
        includeActivity: false,
      });
      if (!details || !profile) return err(appError('NOT_FOUND'));
      return ok({ details, profile });
    },
  };
}

export interface MyProfileSaved {
  readonly personId: string;
  /** Names of the changed fields (no values: personal data stays out of the audit log). */
  readonly changed: readonly string[];
  readonly preferredLocale: 'ar' | 'en';
}

export function updateMyProfileActionDefinition(): ActionDefinition<
  typeof MyProfileInput,
  MyProfileSaved,
  UserTx
> {
  return {
    permission: manageOwn,
    input: MyProfileInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const personId = ctx.actor.personId;
      if (!personId) return err(appError('NOT_FOUND'));
      const details = personalDetailsFrom(input);
      const changed = await updatePersonalDetails(ctx.tx, personId, details);
      if (changed === null) return err(appError('NOT_FOUND'));
      return ok({ personId, changed, preferredLocale: details.preferredLocale });
    },
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.profile.updated',
            entityType: 'person',
            entityId: output.personId,
            data: { changed: output.changed },
          },
  };
}

export const ChangePasswordInput = z
  .strictObject({
    currentPassword: z.string().min(1).max(1024),
    // Minimum 12 (screen 6 proposed default, FR-IAM-13); Auth applies its own policy too.
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'mismatch',
  });

export type ChangePassword = (input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}) => Promise<Result<{ readonly userId: string }, AppError>>;

/** `changePassword` is the identity flow bound to the request (platform-identity/auth). */
export function changeMyPasswordActionDefinition(
  changePassword: ChangePassword,
): ActionDefinition<typeof ChangePasswordInput, { readonly userId: string }, UserTx> {
  return {
    permission: manageOwn,
    input: ChangePasswordInput,
    scoped: true,
    handler: ({ input }) =>
      changePassword({ currentPassword: input.currentPassword, newPassword: input.newPassword }),
    audit: (_input, output) => ({
      action: 'platform.auth.password_changed',
      entityType: 'user',
      entityId: output.userId,
    }),
  };
}
