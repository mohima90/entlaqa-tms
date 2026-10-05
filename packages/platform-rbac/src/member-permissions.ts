import { type Grant } from './authorize';
import { definePermissions } from './permissions';

/**
 * Permissions every member holds on their own record, whatever their roles (FR-IAM-16 My profile):
 * not part of any role, so roles never widen them (an Organization Admin edits other people through
 * `platform.user.update`, not through these).
 */
export const memberPermissions = definePermissions('platform', [
  {
    code: 'platform.profile.manage_own',
    label: { ar: 'إدارة ملفي الشخصي', en: 'Manage my profile' },
    description: {
      ar: 'تعديل البيانات الشخصية وكلمة المرور الخاصة بالمستخدم نفسه',
      en: 'Change one’s own personal details and password',
    },
    risk: 'low',
    requiresAal2: false,
  },
]);

/** The grants every active member has, limited to their own person (`own` scope). */
export const MEMBER_GRANTS: readonly Grant[] = Object.values(memberPermissions).map(
  (permission) => ({
    permission: permission.code,
    scope: { type: 'own' },
  }),
);
