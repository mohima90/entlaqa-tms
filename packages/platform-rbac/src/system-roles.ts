import type { LocalizedText, PermissionDefinition } from './permissions';
import { platformPermissions } from './platform-permissions';

/**
 * The 14 system roles of every organization (BRD §4.2, Appendix B; FR-IAM-07). Platform Super Admin is
 * ENTLAQA-only (platform console, ADR 0003 §6) and is NOT a tenant role (PO, 4 Oct 2026).
 *
 * System roles live in code, versioned with the permissions they grant: organizations cannot edit them
 * (FR-IAM-07), and the database keeps only their codes (`platform.ref_roles`, checked against this list
 * by a drift test) so role assignments can reference them. Custom roles (R2) will be stored per tenant.
 */
export const SYSTEM_ROLE_CODES = [
  'tenant_admin',
  'training_manager',
  'training_coordinator',
  'hr_manager',
  'finance_manager',
  'compliance_officer',
  'department_head',
  'line_manager',
  'internal_instructor',
  'external_instructor',
  'provider_admin',
  'mentor',
  'learner',
  'auditor',
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

/**
 * How far a role's permission reaches. Resolved per request into a DataScope (scopes.ts):
 * `headed_departments` = the departments the member heads (platform.departments.head_person_id),
 * including their sub-departments.
 */
export type RoleScope = 'tenant' | 'own' | 'direct_reports' | 'reports_tree' | 'headed_departments';

export interface RoleGrantDefinition {
  readonly permission: PermissionDefinition;
  readonly scope: RoleScope;
}

export interface SystemRoleDefinition {
  readonly code: SystemRoleCode;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  /**
   * Privileged roles can be given or removed only by an Organization Admin (permission
   * `platform.role.assign_privileged`, AAL2) — PO decision 5 Oct 2026 (TM-0003 D-IAM-03). A role is
   * privileged when it manages users or roles, sees finance, the audit log, or organization/security
   * settings (tested in system-roles.test.ts); every other role an HR Manager may give.
   */
  readonly privileged: boolean;
  readonly grants: readonly RoleGrantDefinition[];
}

const p = platformPermissions;
const tenantWide = (...permissions: PermissionDefinition[]): RoleGrantDefinition[] =>
  permissions.map((permission) => ({ permission, scope: 'tenant' }));

/**
 * Platform grants per role, from BRD Appendix B rows "Tenant settings", "Users & roles", "Audit log".
 * `platform.org.read` (branch and department names) is not a row of the matrix; every role that sees
 * people also sees where they sit.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    code: 'tenant_admin',
    name: { ar: 'مدير المنشأة', en: 'Organization Admin' },
    // A setup role (PO, 7 Oct 2026; BRD Appendix B): sets the organization up and hands it over to HR;
    // never core training features (module permissions, M3+) — enforced by system-roles.test.ts — and
    // never held together with the HR Manager role (BR-IAM-4, separation-of-duties.ts).
    description: {
      ar: 'يُعدّ المنشأة: الإعدادات والهوية والمستخدمون والأدوار والأمان والتكاملات وسجل التدقيق، دون الوصول إلى ميزات التدريب.',
      en: 'Sets up the organization: settings, branding, users and roles, security, integrations and audit. No access to training features.',
    },
    privileged: true,
    grants: tenantWide(...Object.values(p)),
  },
  {
    code: 'training_manager',
    name: { ar: 'مدير التدريب', en: 'Training Manager' },
    description: {
      ar: 'الخطط ودليل الدورات والجلسات والموارد والتسجيلات والتقارير.',
      en: 'Plans, catalog, sessions, resources, enrollments and reports.',
    },
    privileged: false,
    grants: tenantWide(p['platform.user.read'], p['platform.role.read'], p['platform.org.read']),
  },
  {
    code: 'training_coordinator',
    name: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    description: {
      ar: 'تشغيل الجلسات يوميًا: الجدولة والتجهيزات والحضور.',
      en: 'Day-to-day session operations: scheduling, logistics and attendance.',
    },
    privileged: false,
    grants: tenantWide(p['platform.user.read'], p['platform.role.read'], p['platform.org.read']),
  },
  {
    code: 'hr_manager',
    name: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    description: {
      ar: 'سجلات الموظفين والتدريب الإلزامي والامتثال، ودعوة المستخدمين وإسناد الأدوار غير المميزة.',
      en: 'Employee records, mandatory training and compliance; invites users and gives non-privileged roles.',
    },
    privileged: true,
    grants: tenantWide(
      p['platform.user.read'],
      p['platform.user.invite'],
      p['platform.user.update'],
      p['platform.user.deactivate'],
      p['platform.role.read'],
      p['platform.role.assign'],
      p['platform.org.read'],
    ),
  },
  {
    code: 'finance_manager',
    name: { ar: 'المدير المالي', en: 'Finance Manager' },
    description: {
      ar: 'الميزانيات وأوامر الشراء والفواتير والمدفوعات.',
      en: 'Budgets, purchase orders, invoices and payments.',
    },
    privileged: true,
    grants: tenantWide(p['platform.user.read'], p['platform.role.read'], p['platform.org.read']),
  },
  {
    code: 'compliance_officer',
    name: { ar: 'مسؤول الامتثال', en: 'Compliance Officer' },
    description: {
      ar: 'لوحات الامتثال والتقارير التنظيمية، وعرض سجل التدقيق.',
      en: 'Compliance dashboards and regulatory reports; reads the audit log.',
    },
    // Reads the audit log (like the Auditor): privileged.
    privileged: true,
    grants: tenantWide(
      p['platform.user.read'],
      p['platform.role.read'],
      p['platform.org.read'],
      p['platform.audit.read'],
    ),
  },
  {
    code: 'department_head',
    name: { ar: 'رئيس القسم', en: 'Department Head' },
    description: {
      ar: 'خطة القسم وموافقاته وتقاريره.',
      en: 'The department’s plan, approvals and reports.',
    },
    privileged: false,
    grants: [
      { permission: p['platform.user.read'], scope: 'headed_departments' },
      { permission: p['platform.role.read'], scope: 'headed_departments' },
      { permission: p['platform.org.read'], scope: 'tenant' },
    ],
  },
  {
    code: 'line_manager',
    name: { ar: 'المدير المباشر', en: 'Line Manager' },
    description: {
      ar: 'طلبات الفريق المباشر وترشيحاته والموافقة عليها.',
      en: 'Direct reports’ requests, nominations and approvals.',
    },
    privileged: false,
    grants: [
      { permission: p['platform.user.read'], scope: 'direct_reports' },
      { permission: p['platform.role.read'], scope: 'direct_reports' },
      { permission: p['platform.org.read'], scope: 'tenant' },
    ],
  },
  {
    code: 'internal_instructor',
    name: { ar: 'مدرب داخلي', en: 'Internal Instructor' },
    description: {
      ar: 'الجلسات المسندة والحضور والمواد والتصحيح.',
      en: 'Assigned sessions, attendance, materials and grading.',
    },
    privileged: false,
    grants: [],
  },
  {
    code: 'external_instructor',
    name: { ar: 'مدرب خارجي', en: 'External Instructor' },
    description: {
      ar: 'الجلسات المسندة فقط، دون الاطلاع على بيانات المنشأة.',
      en: 'Assigned sessions only; no organization data.',
    },
    privileged: false,
    grants: [],
  },
  {
    code: 'provider_admin',
    name: { ar: 'مسؤول جهة التدريب', en: 'Training Provider Admin' },
    description: {
      ar: 'بوابة جهة التدريب: العروض وقوائم المتدربين والفواتير.',
      en: 'Provider portal: offerings, rosters and invoices.',
    },
    privileged: false,
    grants: [],
  },
  {
    code: 'mentor',
    name: { ar: 'مرشد / مقيّم', en: 'Mentor / Assessor' },
    description: {
      ar: 'قوائم الملاحظة والتدريب على رأس العمل للمتدربين المسندين.',
      en: 'On-the-job and observation checklists for assigned trainees.',
    },
    privileged: false,
    grants: [],
  },
  {
    code: 'learner',
    name: { ar: 'متدرب', en: 'Learner' },
    description: {
      ar: 'دليل الدورات والتسجيل والسجل التدريبي والشهادات الخاصة به.',
      en: 'Catalog, enrollments, own training record and certificates.',
    },
    privileged: false,
    grants: [{ permission: p['platform.user.read'], scope: 'own' }],
  },
  {
    code: 'auditor',
    name: { ar: 'مدقق', en: 'Auditor' },
    description: {
      ar: 'عرض السجلات وسجل التدقيق دون أي تعديل.',
      en: 'Read-only access to records and the audit log.',
    },
    privileged: true,
    grants: tenantWide(
      p['platform.user.read'],
      p['platform.role.read'],
      p['platform.org.read'],
      p['platform.tenant.read'],
      p['platform.audit.read'],
    ),
  },
];

const BY_CODE: ReadonlyMap<string, SystemRoleDefinition> = new Map(
  SYSTEM_ROLES.map((role) => [role.code, role]),
);

export function isSystemRoleCode(code: string): code is SystemRoleCode {
  return BY_CODE.has(code);
}

export function getSystemRole(code: SystemRoleCode): SystemRoleDefinition {
  const role = BY_CODE.get(code);
  if (!role) throw new Error(`Unknown system role "${code}"`);
  return role;
}
