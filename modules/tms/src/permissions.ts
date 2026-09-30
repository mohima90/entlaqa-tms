import { definePermissions } from '@jadarat/platform-rbac';

/**
 * TMS permission registry (ADR 0003 §3). Labels follow docs/design/content/glossary-ar-en.md.
 * The full set is derived from BRD Appendix B in M2.
 */
export const tmsPermissions = definePermissions('tms', [
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
