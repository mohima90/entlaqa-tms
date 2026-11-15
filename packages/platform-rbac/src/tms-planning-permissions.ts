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
  {
    // WP-LD-02 (FR-PLN-05, FR-PLN-06; migration 20261115100000): the consolidated training plan — lines,
    // sessions, costs and the budget check per department. Scoped in a custom role (FR-IAM-08 R1 note): a role
    // limited to «A department» reads the plan of that unit and everything under it (feedback #4).
    code: 'tms.training_plan.read',
    label: { ar: 'عرض الخطة التدريبية', en: 'View the training plan' },
    description: {
      ar: 'عرض بنود الخطة التدريبية وجلساتها وتكلفتها ومقارنة كل إدارة بميزانيتها ضمن النطاق',
      en: 'View the training plan’s lines, sessions and cost, and each department against its budget, within scope',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.training_plan.manage',
    label: { ar: 'إعداد الخطة التدريبية', en: 'Build the training plan' },
    description: {
      ar: 'دمج البنود وتحديد حجم الجلسات وتكلفتها وربعها واستبعاد البنود مع ذكر السبب وتبرير تجاوز الميزانية ضمن النطاق',
      en: 'Merge lines, set session sizes, costs and quarters, leave lines out with a reason and explain an over-budget department, within scope',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    // WP-LD-03 (FR-PLN-08, FR-WFL-01/02 R1 part; migration 20261116100000): the HR Manager's step — approve the
    // submitted plan or send it back with a comment. Approval goes by role (EP-PLN §13 a): never in a custom role.
    code: 'tms.training_plan.approve',
    label: { ar: 'اعتماد الخطة التدريبية', en: 'Approve the training plan' },
    description: {
      ar: 'اعتماد الخطة التدريبية المرسلة أو إعادتها إلى مدير التعلم والتطوير مع تعليق',
      en: 'Approve the submitted training plan or send it back to the L&D Manager with a comment',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    // WP-LD-03: the Finance step, where Planning settings «Finance confirms the plan» is on (EP-PLN §13 b–d).
    code: 'tms.training_plan.confirm',
    label: { ar: 'تأكيد الخطة التدريبية ماليًا', en: 'Confirm the training plan for Finance' },
    description: {
      ar: 'تأكيد الخطة التدريبية بعد اعتماد مدير الموارد البشرية أو إعادتها مع تعليق',
      en: 'Confirm the training plan after the HR Manager approved it, or send it back with a comment',
    },
    risk: 'medium',
    requiresAal2: false,
  },
]);

export type TmsPlanningPermissionCode = keyof typeof tmsPlanningPermissions;
