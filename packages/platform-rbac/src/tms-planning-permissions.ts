import { definePermissions } from './permissions';

/**
 * Planning-cycle permissions of the TMS module (EP-PLN, BACKLOG T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part;
 * business flow docs/business-flows/EP-PLN-planning-cycle.md). Declared here, not in modules/tms, because
 * the standard roles that grant them live in this package (system-roles.ts) and packages never import
 * modules (ADR 0001); modules/tms re-exports them with its other permissions. Mirrored in
 * `platform.ref_permissions` / `platform.ref_role_permissions` (migration 20261020150000; drift test in
 * custom-roles.test.ts). Labels follow docs/design/content/glossary-ar-en.md (#119 «حصر الاحتياجات» for the TNA
 * campaign — «دورة» means a course, #32); DRAFT until the UX writer's review.
 */
export const tmsPlanningPermissions = definePermissions('tms', [
  {
    code: 'tms.plan_cycle.read',
    label: { ar: 'عرض حملات حصر الاحتياجات', en: 'View planning cycles' },
    description: {
      ar: 'عرض حملات حصر الاحتياجات التدريبية وإعدادها وتقدّم الأقسام فيها',
      en: 'View planning cycles, their set-up and each department’s progress',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.plan_cycle.manage',
    label: { ar: 'إدارة حملات حصر الاحتياجات', en: 'Manage planning cycles' },
    description: {
      ar: 'إنشاء حملات حصر الاحتياجات وتعديلها وإطلاقها وحذف المسودات وتمديد الموعد النهائي وإعدادات التخطيط',
      en: 'Create, edit and launch planning cycles, delete drafts, extend deadlines and edit the planning settings',
    },
    risk: 'medium',
    requiresAal2: false,
  },
]);

export type TmsPlanningPermissionCode = keyof typeof tmsPlanningPermissions;
