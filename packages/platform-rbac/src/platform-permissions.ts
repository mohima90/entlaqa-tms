import { definePermissions } from './permissions';

/**
 * Platform permission registry (ADR 0003 §3): people directory, roles, organization structure,
 * organization settings, security policy, audit log. Module permissions (tms.*, …) are declared by the
 * modules. Labels follow docs/design/content/glossary-ar-en.md. High-risk permissions confirm the session
 * with Auth (getUser); none requires an authenticator code (AAL2) — PO decision, 14 Oct 2026, reversing
 * D-IAM-01: a second factor is the organization's sign-in MFA policy.
 */
export const platformPermissions = definePermissions('platform', [
  {
    code: 'platform.user.read',
    label: { ar: 'عرض المستخدمين', en: 'View users' },
    description: {
      ar: 'عرض المستخدمين وملفاتهم ضمن النطاق',
      en: 'View users and their profiles within scope',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'platform.user.invite',
    label: { ar: 'دعوة المستخدمين', en: 'Invite users' },
    description: {
      ar: 'دعوة أشخاص إلى المنشأة وإدارة الدعوات',
      en: 'Invite people to the organization and manage invitations',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'platform.user.update',
    label: { ar: 'تعديل بيانات المستخدمين', en: 'Edit users' },
    description: {
      ar: 'تعديل البيانات الأساسية والتنظيمية للمستخدمين',
      en: 'Edit users’ profile and placement',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'platform.user.deactivate',
    label: { ar: 'تعطيل المستخدمين وإعادة تفعيلهم', en: 'Deactivate and reactivate users' },
    description: {
      ar: 'تعطيل الحسابات وإعادة تفعيلها وإنهاء جلسات الدخول',
      en: 'Deactivate and reactivate accounts and end sign-in sessions',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    // PO answer (9 Oct 2026; TM-0003 T-IAM-10): the Organization Admin resets a lost authenticator app of a
    // member of their organization (no code of their own needed since the PO decision of 14 Oct 2026). Last Organization Admin and people in
    // several organizations: ENTLAQA support (docs/engineering/mfa-reset.md).
    code: 'platform.user.reset_mfa',
    label: { ar: 'إعادة ضبط تطبيق المصادقة', en: 'Reset authenticator apps' },
    description: {
      ar: 'إزالة تطبيق المصادقة لعضو فقده، ليُعدّ تطبيقًا جديدًا عند دخوله التالي',
      en: 'Remove the authenticator app of a member who lost it, so they set up a new one at their next sign-in',
    },
    risk: 'high',
    requiresAal2: false,
  },
  {
    // T-M2-11 (PO decision 9 Oct 2026): end a member's sign-in lock after repeated failed attempts.
    // Organization Admin only (the database checks the role again).
    code: 'platform.user.unlock_sign_in',
    label: { ar: 'إلغاء إيقاف تسجيل الدخول', en: 'Unlock sign-in' },
    description: {
      ar: 'إلغاء إيقاف تسجيل الدخول المؤقت بعد محاولات كثيرة لم تنجح',
      en: 'End a temporary sign-in lock after too many unsuccessful attempts',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    // WP-ADM-04 (FR-IAM-02; business flow EP-PEOPLE-photo-hr-fields, PO 21 Oct 2026): gender, date of birth and
    // employment category of every member. The HR Manager holds it; the Organization Admin does NOT (a set-up
    // role). A custom role may hold it with the whole organization as its scope and is then privileged. The
    // person always reads their own, read-only, without it.
    code: 'platform.person.hr_details',
    label: { ar: 'عرض بيانات الموارد البشرية وتعديلها', en: 'View and edit HR-only fields' },
    description: {
      ar: 'الجنس وتاريخ الميلاد وفئة التوظيف لجميع الأعضاء، ولا تمنح هذه البيانات أي وصول',
      en: 'Gender, date of birth and employment category of every member. They never give access to anything',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'platform.role.read',
    label: { ar: 'عرض الأدوار والصلاحيات', en: 'View roles and permissions' },
    description: {
      ar: 'عرض الأدوار وصلاحياتها ومن يحملها',
      en: 'View roles, their permissions and who holds them',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'platform.role.assign',
    label: { ar: 'إسناد الأدوار', en: 'Assign roles' },
    description: {
      ar: 'إسناد الأدوار غير المميزة وسحبها',
      en: 'Give and remove roles that are not privileged',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'platform.role.assign_privileged',
    label: { ar: 'إسناد الأدوار المميزة', en: 'Assign privileged roles' },
    description: {
      ar: 'إسناد دور مدير المنظمة والأدوار المميزة الأخرى وسحبها',
      en: 'Give and remove the Organization Admin role and other privileged roles',
    },
    risk: 'high',
    requiresAal2: false,
  },
  {
    // EP-ROLES (FR-IAM-07, PO 17 Oct 2026): create, change and delete the organization's custom roles. The
    // Organization Admin only — never part of a custom role (custom-roles.ts), so nobody else builds roles.
    code: 'platform.role.manage',
    label: { ar: 'إدارة الأدوار المخصصة', en: 'Manage custom roles' },
    description: {
      ar: 'إنشاء الأدوار المخصصة وتعديل صلاحياتها وحذفها',
      en: 'Create custom roles, change their permissions and delete them',
    },
    risk: 'high',
    requiresAal2: false,
  },
  {
    code: 'platform.org.read',
    label: { ar: 'عرض الهيكل التنظيمي', en: 'View organization structure' },
    description: {
      ar: 'عرض الفروع ووحدات الهيكل',
      en: 'View branches and the units of the structure',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'platform.org.manage',
    label: { ar: 'إدارة الهيكل التنظيمي', en: 'Manage organization structure' },
    description: {
      ar: 'إنشاء الفروع ووحدات الهيكل ومستوياته وتعديلها وحذفها',
      en: 'Create, edit and delete branches, the units of the structure and its levels',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    code: 'platform.tenant.read',
    label: { ar: 'عرض إعدادات المنشأة', en: 'View organization settings' },
    description: {
      ar: 'عرض بيانات المنشأة وهويتها البصرية ونطاقاتها',
      en: 'View the organization’s profile, branding and domains',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'platform.tenant.manage',
    label: { ar: 'إدارة إعدادات المنشأة', en: 'Manage organization settings' },
    description: {
      ar: 'تعديل بيانات المنشأة وهويتها البصرية ونطاقاتها',
      en: 'Change the organization’s profile, branding and domains',
    },
    risk: 'high',
    requiresAal2: false,
  },
  {
    code: 'platform.security.manage',
    label: { ar: 'إدارة إعدادات الأمان', en: 'Manage security settings' },
    description: {
      ar: 'التحقق متعدد العوامل وسياسة كلمة المرور والقفل وجلسات الدخول',
      en: 'Multi-factor authentication, password policy, lockout and sign-in sessions',
    },
    risk: 'high',
    requiresAal2: false,
  },
  {
    code: 'platform.audit.read',
    label: { ar: 'عرض سجل التدقيق', en: 'View the audit log' },
    description: { ar: 'عرض سجل التدقيق للمنشأة', en: 'View the organization’s audit log' },
    // High since EP-ROLES (PO, 17 Oct 2026): a custom role is privileged when it holds a high-risk
    // permission, and reading the audit log has always made a role privileged (Auditor, Compliance Officer).
    risk: 'high',
    requiresAal2: false,
  },
]);

export type PlatformPermissionCode = keyof typeof platformPermissions;

/**
 * Module permissions that STANDARD roles grant (system-roles.ts) and the permission catalogue lists
 * (`platform.ref_permissions`, drift test in custom-roles.test.ts). platform-rbac never imports a module
 * (ADR 0001), so they are declared here; the TMS module re-exports them (modules/tms permissions.ts).
 * Both are part of the custom-role catalogue since who can give what (PO, 17 Oct 2026): the Organization
 * Admin builds roles with permissions it does not hold itself (custom-roles.ts).
 */
export const tmsRolePermissions = definePermissions('tms', [
  {
    // T-M3-10 (FR-PLN-02/03; PO, 17 Oct 2026): the needs forms library and builder.
    code: 'tms.needs_form.read',
    label: { ar: 'عرض نماذج الاحتياجات', en: 'View needs forms' },
    description: {
      ar: 'عرض نماذج الاحتياجات التدريبية وأقسامها وحقولها',
      en: 'View the training needs forms, their sections and fields',
    },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'tms.needs_form.manage',
    label: { ar: 'تصميم نماذج الاحتياجات', en: 'Design needs forms' },
    description: {
      ar: 'إنشاء نماذج الاحتياجات التدريبية وتعديلها ونسخها وحذفها وتعيين النموذج الافتراضي',
      en: 'Create, change, duplicate and delete training needs forms and choose the default form',
    },
    risk: 'medium',
    requiresAal2: false,
  },
  {
    // WP-LD-01 (FR-PLN-03, FR-MGR-05; PO decisions 27 Oct 2026): the Department Head enters, submits and recalls
    // the needs of the departments they head (the effective head, as the database checks).
    code: 'tms.plan_needs.submit',
    label: { ar: 'إدخال احتياجات الإدارة', en: 'Enter the department’s training needs' },
    description: {
      ar: 'إدخال الاحتياجات التدريبية للإدارات التي يرأسها وإرسالها وسحبها قبل الموعد النهائي',
      en: 'Enter, submit and recall the training needs of the departments they head before the deadline',
    },
    risk: 'low',
    requiresAal2: false,
  },
]);

export type TmsRolePermissionCode = keyof typeof tmsRolePermissions;
