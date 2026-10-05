import { definePermissions } from './permissions';

/**
 * Platform permission registry (ADR 0003 §3): people directory, roles, organization structure,
 * organization settings, security policy, audit log. Module permissions (tms.*, …) are declared by the
 * modules. Labels follow docs/design/content/glossary-ar-en.md. High-risk permissions require AAL2.
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
      ar: 'إسناد دور مدير المنشأة والأدوار المميزة الأخرى وسحبها',
      en: 'Give and remove the Organization Admin role and other privileged roles',
    },
    risk: 'high',
    requiresAal2: true,
  },
  {
    code: 'platform.org.read',
    label: { ar: 'عرض الهيكل التنظيمي', en: 'View organization structure' },
    description: { ar: 'عرض الفروع والأقسام', en: 'View branches and departments' },
    risk: 'low',
    requiresAal2: false,
  },
  {
    code: 'platform.org.manage',
    label: { ar: 'إدارة الهيكل التنظيمي', en: 'Manage organization structure' },
    description: {
      ar: 'إنشاء الفروع والأقسام وتعديلها وحذفها',
      en: 'Create, edit and delete branches and departments',
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
    requiresAal2: true,
  },
  {
    code: 'platform.security.manage',
    label: { ar: 'إدارة إعدادات الأمان', en: 'Manage security settings' },
    description: {
      ar: 'التحقق متعدد العوامل وسياسة كلمة المرور والقفل وجلسات الدخول',
      en: 'Multi-factor authentication, password policy, lockout and sign-in sessions',
    },
    risk: 'high',
    requiresAal2: true,
  },
  {
    code: 'platform.audit.read',
    label: { ar: 'عرض سجل التدقيق', en: 'View the audit log' },
    description: { ar: 'عرض سجل التدقيق للمنشأة', en: 'View the organization’s audit log' },
    risk: 'medium',
    requiresAal2: false,
  },
]);

export type PlatformPermissionCode = keyof typeof platformPermissions;
