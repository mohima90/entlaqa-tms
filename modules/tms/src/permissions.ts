import { coursePermissions, definePermissions } from '@jadarat/platform-rbac';

/**
 * TMS permission registry (ADR 0003 §3). Labels follow docs/design/content/glossary-ar-en.md.
 * The course library's permissions (T-M3-03) are declared with the standard roles in platform-rbac
 * (course-permissions.ts: the platform's roles and role builder name them, and a platform package never
 * imports a module); they are part of this registry. The others are not held by any role yet.
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

export const tmsPermissions = { ...coursePermissions, ...sessionPermissions } as const;
