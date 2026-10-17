import {
  coursePermissions,
  definePermissions,
  tmsPlanningPermissions,
  tmsRolePermissions,
} from '@jadarat/platform-rbac';

/**
 * TMS permission registry (ADR 0003 §3). Labels follow docs/design/content/glossary-ar-en.md.
 * The permissions standard roles grant — course library (T-M3-03), planning cycles (EP-PLN) and needs forms
 * (T-M3-10) — are declared in platform-rbac (course-permissions.ts, tms-planning-permissions.ts,
 * tmsRolePermissions in platform-permissions.ts: the platform's roles and role builder name them, and a
 * platform package never imports a module) and re-exported here, so the module has one registry. The session
 * permissions are not held by any role yet.
 */
const sessionPermissions = definePermissions('tms', [
  {
    code: 'tms.session.read',
    label: { ar: 'عرض الجلسات', en: 'View sessions' },
    description: {
      ar: 'عرض الجلسات التدريبية ضمن النطاق',
      en: 'View training sessions within scope',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.session.create',
    label: { ar: 'إنشاء جلسة', en: 'Create session' },
    description: { ar: 'إنشاء جلسة تدريبية جديدة', en: 'Create a new training session' },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'tms.enrollment.approve',
    label: { ar: 'اعتماد التسجيل', en: 'Approve enrollment' },
    description: {
      ar: 'اعتماد طلبات التسجيل في الجلسات ضمن النطاق',
      en: 'Approve session enrollment requests within scope',
    },
    risk: 'medium',
    requiresAal2: false,
  },
]);

/** Every TMS permission: courses, sessions (skeleton), planning cycles and needs forms. */
export const tmsPermissions = Object.freeze({
  ...coursePermissions,
  ...sessionPermissions,
  ...tmsPlanningPermissions,
  ...tmsRolePermissions,
});
