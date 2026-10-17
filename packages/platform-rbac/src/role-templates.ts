import { type CustomRoleScope, customRolePermission, standardRoleScope } from './custom-roles';
import type { LocalizedText } from './permissions';
import { getSystemRole, type SystemRoleCode } from './system-roles';

/**
 * «Start from» presets of the role builder (EP-ROLES, PO 17 Oct 2026; BRD v3.1 Appendix B; roles README
 * §3.2b). Templates are presets in code, not roles: choosing one fills the create form (name, description,
 * permissions, data scope), and the Organization Admin edits it before saving a custom role. They replace
 * the former Instructor, Line Manager, Finance, Compliance Officer and Auditor system roles with their
 * former platform permissions. Module permissions (sessions, grading, budgets, …) join them as those
 * modules ship.
 */
export const ROLE_TEMPLATE_KEYS = [
  'instructor',
  'finance_approver',
  'line_manager',
  'compliance_officer',
  'auditor',
] as const;
export type RoleTemplateKey = (typeof ROLE_TEMPLATE_KEYS)[number];

export interface RoleTemplate {
  readonly key: RoleTemplateKey;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly dataScope: CustomRoleScope;
  readonly permissions: readonly string[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: 'instructor',
    name: { ar: 'مدرب', en: 'Instructor' },
    description: {
      ar: 'الجلسات المسندة إليه والحضور والتصحيح. نطاقه فريقه إلى أن يتوفر نطاق «الجلسات المسندة فقط».',
      en: 'Sessions assigned to them, attendance and grading. Scoped to their team until the “assigned sessions only” scope is available.',
    },
    // "Assigned sessions only" is not one of the four scopes yet (sessions ship with M4): their team.
    dataScope: 'team',
    permissions: ['platform.user.read', 'platform.org.read'],
  },
  {
    key: 'finance_approver',
    name: { ar: 'معتمد مالي', en: 'Finance approver' },
    description: {
      ar: 'يعتمد التكلفة والميزانية في خطوة المالية، ويرى الميزانيات وتقارير التكلفة عند توفرها.',
      en: 'Approves cost and budget at the finance step; sees budgets and cost reports when they ship.',
    },
    dataScope: 'organization',
    permissions: ['platform.user.read', 'platform.role.read', 'platform.org.read'],
  },
  {
    key: 'line_manager',
    name: { ar: 'مدير مباشر', en: 'Line Manager' },
    description: {
      ar: 'طلبات فريقه المباشر وترشيحاته والموافقة عليها.',
      en: 'Direct reports’ requests, nominations and approvals.',
    },
    dataScope: 'team',
    permissions: ['platform.user.read', 'platform.role.read', 'platform.org.read'],
  },
  {
    key: 'compliance_officer',
    name: { ar: 'مسؤول الامتثال', en: 'Compliance Officer' },
    description: {
      ar: 'لوحات الامتثال والتقارير التنظيمية، وعرض سجل التدقيق.',
      en: 'Compliance dashboards and regulatory reports; reads the audit log.',
    },
    dataScope: 'organization',
    permissions: [
      'platform.user.read',
      'platform.role.read',
      'platform.org.read',
      'platform.audit.read',
    ],
  },
  {
    key: 'auditor',
    name: { ar: 'مدقق', en: 'Auditor' },
    description: {
      ar: 'عرض السجلات وسجل التدقيق دون أي تعديل.',
      en: 'Read-only access to records and the audit log.',
    },
    dataScope: 'organization',
    permissions: [
      'platform.user.read',
      'platform.role.read',
      'platform.org.read',
      'platform.tenant.read',
      'platform.audit.read',
    ],
  },
];

/** A «start from» choice: blank, a standard role's permissions, or a template. */
export type RoleStart =
  | { readonly kind: 'blank' }
  | { readonly kind: 'standard'; readonly code: SystemRoleCode }
  | { readonly kind: 'template'; readonly key: RoleTemplateKey };

export interface RoleStartValues {
  readonly name: LocalizedText | null;
  readonly description: LocalizedText | null;
  readonly dataScope: CustomRoleScope;
  readonly permissions: readonly string[];
}

/** What a «start from» choice fills in (copying a standard role copies its permissions, not its name). */
export function roleStartValues(start: RoleStart): RoleStartValues {
  switch (start.kind) {
    case 'blank':
      return { name: null, description: null, dataScope: 'organization', permissions: [] };
    case 'standard': {
      const role = getSystemRole(start.code);
      return {
        name: null,
        description: null,
        dataScope: standardRoleScope(role),
        // Only what a custom role can hold (never the Organization Admin's own role permissions).
        permissions: [...new Set(role.grants.map((g) => g.permission.code))].filter(
          (code) => customRolePermission(code) !== undefined,
        ),
      };
    }
    case 'template': {
      const template = ROLE_TEMPLATES.find((t) => t.key === start.key);
      if (!template) throw new Error(`Unknown role template "${start.key}"`);
      return {
        name: template.name,
        description: template.description,
        dataScope: template.dataScope,
        permissions: template.permissions,
      };
    }
  }
}
