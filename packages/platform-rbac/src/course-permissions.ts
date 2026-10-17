import { definePermissions } from './permissions';

/**
 * Course library permissions of the TMS module (T-M3-03; FR-CAT-01, FR-CAT-10; BRD Appendix B row
 * «Course library & programs»: HR Manager V, L&D Manager F, Training Coordinator E, Department Head V,
 * Organization Admin none — BR-IAM-4; the Employee's V comes with their own catalogue, M4).
 *
 * Declared in the platform package although they belong to the `tms` namespace: the six standard roles
 * (system-roles.ts) and the permission catalogue of the custom role builder (custom-roles.ts) are platform
 * definitions that must name them, and a platform package never imports a module (ADR 0001 boundaries).
 * The TMS module re-exports them as part of its registry (`tmsPermissions`). Mirrored in
 * `platform.ref_permissions` / `platform.ref_role_permissions` (migration 20261020120000, drift tests).
 *
 * - Reading the library and its planning costs is organization data (no personal data): granted
 *   organization-wide to every role that sees the library.
 * - The estimated costs are a permission of their own so that a role can see the library without the
 *   organization's planning costs (employees, once their catalogue ships; custom roles).
 * - Archiving (and restoring) stays with the L&D Manager ("F = full"); the Training Coordinator adds and
 *   edits ("E"), as agreed in the planning-cycle business flow (EP-PLN step A2).
 */
export const coursePermissions = definePermissions('tms', [
  {
    code: 'tms.course.read',
    label: { ar: 'عرض دليل الدورات', en: 'View the course library' },
    description: {
      ar: 'عرض الدورات التدريبية وتصنيفاتها وأنماط تقديمها',
      en: 'View training courses, their categories and delivery types',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.course_cost.read',
    label: { ar: 'عرض التكلفة التقديرية للدورات', en: 'View estimated course costs' },
    description: {
      ar: 'عرض التكلفة التقديرية للجلسة والمشارك المستخدمة في التخطيط',
      en: 'View the estimated cost per session and per participant used for planning',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.course.manage',
    label: { ar: 'إدارة الدورات', en: 'Manage courses' },
    description: {
      ar: 'إضافة الدورات وتصنيفاتها وتعديلها',
      en: 'Add and edit courses and their categories',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'tms.course.archive',
    label: { ar: 'أرشفة الدورات', en: 'Archive courses' },
    description: {
      ar: 'أرشفة الدورات واستعادتها من الأرشيف',
      en: 'Archive courses and restore them from the archive',
    },
    risk: 'medium',
    requiresAal2: false,
  },
]);

export type CoursePermissionCode = keyof typeof coursePermissions;
