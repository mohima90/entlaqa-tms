import type { LocalizedText, PermissionDefinition } from './permissions';
import { platformPermissions } from './platform-permissions';
import { tmsPlanningPermissions } from './tms-planning-permissions';

/**
 * The six standard roles of every organization (EP-ROLES, PO 17 Oct 2026; BRD v3.1 §4.2, Appendix B;
 * FR-IAM-07). Platform Super Admin is ENTLAQA-only (platform console, ADR 0003 §6) and is NOT a tenant
 * role (PO, 4 Oct 2026).
 *
 * Standard roles live in code, versioned with the permissions they grant: organizations cannot edit them
 * (FR-IAM-07), and the database keeps their codes (`platform.ref_roles`) and grants
 * (`platform.ref_role_permissions`), checked against this list by drift tests, so assignments can reference
 * them and the database guards can decide by permission. Custom roles are stored per organization
 * (custom-roles.ts, `platform.custom_roles`). A person holds ONE role per organization (Kawadir; PO,
 * 17 Oct 2026).
 */
export const SYSTEM_ROLE_CODES = [
  'tenant_admin',
  'hr_manager',
  'training_manager',
  'training_coordinator',
  'department_head',
  'learner',
] as const;

/**
 * The eight former system roles (T-M2-03) that are no longer standard (EP-ROLES, PO 17 Oct 2026). Their
 * assignments were mapped by migration 20261019090300 (docs/delivery/roles/README.md §4) and their codes
 * removed from `platform.ref_roles`: nobody can be given them. Their names stay for history only (audit
 * events and old invitations name them); the former Instructor, Line Manager, Finance, Compliance and
 * Auditor roles are custom-role templates now (role-templates.ts).
 */
export const FORMER_ROLE_NAMES: Readonly<Record<string, LocalizedText>> = {
  finance_manager: { ar: 'المدير المالي', en: 'Finance Manager' },
  compliance_officer: { ar: 'مسؤول الامتثال', en: 'Compliance Officer' },
  line_manager: { ar: 'المدير المباشر', en: 'Line Manager' },
  internal_instructor: { ar: 'مدرب داخلي', en: 'Internal Instructor' },
  external_instructor: { ar: 'مدرب خارجي', en: 'External Instructor' },
  provider_admin: { ar: 'مسؤول جهة التدريب', en: 'Training Provider Admin' },
  mentor: { ar: 'مرشد / مقيّم', en: 'Mentor / Assessor' },
  auditor: { ar: 'مدقق', en: 'Auditor' },
};

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
/** Planning cycles (EP-PLN, T-M3-04): the L&D Manager manages them, the Training Coordinator reads them. */
const pln = tmsPlanningPermissions;
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
    // «مدير المنظمة» (Kawadir; PO, 17 Oct 2026 — replaces «مدير المنشأة»).
    name: { ar: 'مدير المنظمة', en: 'Organization Admin' },
    // A setup role (PO, 7 Oct 2026; BRD Appendix B): sets the organization up and hands it over to HR;
    // never core training features (module permissions, M3+) — enforced by system-roles.test.ts — and
    // always held alone (BR-IAM-4; one role per person since EP-ROLES).
    description: {
      ar: 'يُعدّ المنظمة: الإعدادات والهوية والمستخدمون والأدوار والأمان والتكاملات وسجل التدقيق، دون الوصول إلى ميزات التدريب.',
      en: 'Sets up the organization: settings, branding, users and roles, security, integrations and audit. No access to training features.',
    },
    privileged: true,
    // Every platform permission except the organization structure, which the HR Manager maintains
    // (PO decision 11 Oct 2026, BRD v2.7 FR-ADM-04/05; T-M2-19).
    grants: tenantWide(
      ...Object.values(p).filter((permission) => permission !== p['platform.org.manage']),
    ),
  },
  {
    code: 'hr_manager',
    name: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    description: {
      ar: 'سجلات الموظفين والفروع والأقسام ورؤساؤها وقواعد الامتثال، ودعوة المستخدمين وإسناد الأدوار غير المميزة.',
      en: 'Employee records, branches, departments and department heads, compliance rules; invites people and gives roles that are not privileged.',
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
      // Branches and departments (PO decision 11 Oct 2026, BRD v2.7 FR-ADM-04/05; T-M2-19).
      p['platform.org.manage'],
    ),
  },
  {
    code: 'training_manager',
    // Display name «مدير التعلم والتطوير» / "L&D Manager" (PO, 14 Oct 2026; BRD v2.9); the code stays.
    name: { ar: 'مدير التعلم والتطوير', en: 'L&D Manager' },
    description: {
      ar: 'دليل الدورات ودورات التخطيط والخطة والميزانية والموافقات والجلسات والإشعارات وتقارير التدريب.',
      en: 'Course library, planning cycles, plan and budget, approvals, sessions, notifications and training reports.',
    },
    privileged: false,
    grants: tenantWide(
      p['platform.user.read'],
      p['platform.role.read'],
      p['platform.org.read'],
      pln['tms.plan_cycle.read'],
      pln['tms.plan_cycle.manage'],
    ),
  },
  {
    code: 'training_coordinator',
    name: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    description: {
      ar: 'الجدولة والتجهيزات والتسجيلات والحضور، والمساعدة في جمع الاحتياجات وتوحيدها.',
      en: 'Scheduling, logistics, enrollments and attendance; helps collect and consolidate needs.',
    },
    privileged: false,
    grants: tenantWide(
      p['platform.user.read'],
      p['platform.role.read'],
      p['platform.org.read'],
      pln['tms.plan_cycle.read'],
    ),
  },
  {
    code: 'department_head',
    name: { ar: 'رئيس القسم', en: 'Department Head' },
    description: {
      ar: 'أقسامه فقط: يقترح الاحتياجات ويعتمد بنود الخطة والطلبات ويرى فريقه.',
      en: 'Their departments only: proposes needs, approves plan lines and requests, sees the team.',
    },
    privileged: false,
    grants: [
      { permission: p['platform.user.read'], scope: 'headed_departments' },
      { permission: p['platform.role.read'], scope: 'headed_departments' },
      { permission: p['platform.org.read'], scope: 'tenant' },
    ],
  },
  {
    code: 'learner',
    // «موظف» / "Employee" (PO, 17 Oct 2026 — replaces «متدرب» / Learner); the code stays.
    name: { ar: 'موظف', en: 'Employee' },
    description: {
      ar: 'طلباته وتدريبه وشهاداته.',
      en: 'Own requests, training and certificates.',
    },
    privileged: false,
    grants: [{ permission: p['platform.user.read'], scope: 'own' }],
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
