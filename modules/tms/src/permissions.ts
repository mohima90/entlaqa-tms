import { definePermissions, tmsRolePermissions } from '@jadarat/platform-rbac';

/**
 * TMS permission registry (ADR 0003 §3). Labels follow docs/design/content/glossary-ar-en.md.
 * The permissions standard roles grant are declared in platform-rbac (tmsRolePermissions: platform-rbac
 * never imports a module, ADR 0001) and re-exported here, so the module has one registry.
 */
const ownPermissions = definePermissions('tms', [
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

export const tmsPermissions = Object.freeze({ ...ownPermissions, ...tmsRolePermissions });
