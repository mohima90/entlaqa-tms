import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PreviewShell, fieldClass, localeOf } from '../../.storybook/theme-preview-kit';
import { Alert } from '../alert';
import { Button, buttonClasses } from '../button';
import { TextField } from '../text-field';

/**
 * Theme preview (T-M2-04c): the invite form (screen 2) as built — form patterns of
 * apps/suite/src/components/users/invite-user-form.tsx (text fields, selects, the single Role select
 * of EP-ROLES with its department hint, radio buttons, an error and an info message).
 */
const meta = {
  title: 'Theme preview/Invite form',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const COPY = {
  ar: {
    breadcrumbLabel: 'مسار التنقل',
    breadcrumb: 'المستخدمون',
    title: 'دعوة مستخدم',
    intro:
      'نرسل رسالة إلى البريد الإلكتروني للعمل فيها رابط لتعيين كلمة المرور والدخول. لا يُنشأ الحساب قبل قبول الدعوة.',
    person: 'بيانات الشخص',
    email: 'البريد الإلكتروني للعمل',
    emailHint: 'يصبح هذا البريد اسم الدخول. لا يتكرر في المنشأة نفسها.',
    emailTaken: 'هذا البريد مسجّل لشخص آخر في المنشأة، أو لديه دعوة لم تُقبل بعد.',
    firstName: 'الاسم الأول',
    familyName: 'اسم العائلة',
    addEnglishName: 'إضافة الاسم بالإنجليزية (اختياري)',
    department: 'القسم',
    noDepartment: 'بدون قسم',
    manager: 'المدير المباشر',
    noManager: 'بدون مدير مباشر',
    managerHint:
      'القائمة تعرض أصحاب الأدوار الإدارية في القسم المختار، ويتغير محتواها بتغيير القسم.',
    required: '(مطلوب)',
    optional: '(اختياري)',
    role: 'الدور',
    roleHint: 'لكل شخص دور واحد، يحدد قائمته وصفحاته والبيانات التي يراها.',
    departmentsHint:
      'يرى هذا الدور الأقسام التي يرأسها الشخص مع أقسامها الفرعية. يحدد رؤساء الأقسام مدير الموارد البشرية من المنظمة ← الهيكل التنظيمي.',
    standardGroup: 'الأدوار القياسية',
    customGroup: 'الأدوار المخصصة',
    privileged: 'مميز',
    rolesHelp: 'ما يفعله كل دور',
    language: 'لغة رسالة الدعوة',
    expiryNotice:
      'تبقى الدعوة صالحة 7 أيام (حتى 16 أكتوبر 2026). يمكنك إعادة إرسالها حتى 3 مرات أو إلغاؤها من قائمة المستخدمين.',
    submit: 'إرسال الدعوة',
    back: 'رجوع',
    roles: [
      ['training_coordinator', 'منسق التدريب', false, 'standard'],
      ['training_manager', 'مدير التعلم والتطوير', false, 'standard'],
      ['department_head', 'رئيس القسم', false, 'standard'],
      ['learner', 'موظف', false, 'standard'],
      ['hr_manager', 'مدير الموارد البشرية', true, 'standard'],
      ['custom_5eed00000001', 'مدير مباشر', false, 'custom'],
    ],
  },
  en: {
    breadcrumbLabel: 'Breadcrumb',
    breadcrumb: 'Users',
    title: 'Invite a user',
    intro:
      'We send an email to the work address with a link to set a password and sign in. No account is created until the invitation is accepted.',
    person: 'Person details',
    email: 'Work email',
    emailHint: 'This email becomes the sign-in name. It must be unique within the organization.',
    emailTaken:
      'This email belongs to someone else in the organization, or has an invitation not accepted yet.',
    firstName: 'First name',
    familyName: 'Family name',
    addEnglishName: 'Add the name in English (optional)',
    department: 'Department',
    noDepartment: 'No department',
    manager: 'Direct manager',
    noManager: 'No direct manager',
    managerHint:
      'The list shows people with managing roles in the chosen department and changes with the department.',
    required: '(required)',
    optional: '(optional)',
    role: 'Role',
    roleHint: 'Each person has one role. It decides their menu, pages and the data they see.',
    departmentsHint:
      'This role sees the departments the person heads, with their sub-departments. HR sets department heads in Organization → Structure.',
    standardGroup: 'Standard roles',
    customGroup: 'Custom roles',
    privileged: 'privileged',
    rolesHelp: 'What each role does',
    language: 'Invitation email language',
    expiryNotice:
      'The invitation stays valid for 7 days (until 16 Oct 2026). You can resend it up to 3 times or revoke it from the users list.',
    submit: 'Send invitation',
    back: 'Go back',
    roles: [
      ['training_coordinator', 'Training Coordinator', false, 'standard'],
      ['training_manager', 'L&D Manager', false, 'standard'],
      ['department_head', 'Department Head', false, 'standard'],
      ['learner', 'Employee', false, 'standard'],
      ['hr_manager', 'HR Manager', true, 'standard'],
      ['custom_5eed00000001', 'Line Manager', false, 'custom'],
    ],
  },
} as const;

function InviteFormPage({ locale }: { locale: 'ar' | 'en' }) {
  const t = COPY[locale];
  const [role, setRole] = useState('department_head');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  return (
    <PreviewShell locale={locale}>
      <nav aria-label={t.breadcrumbLabel} className="mb-2 text-sm">
        <a href="#users">{t.breadcrumb}</a>
      </nav>
      <h1 className="mb-2 mt-0 text-2xl font-bold">{t.title}</h1>
      <p className="mb-6 mt-0 text-text-muted">{t.intro}</p>
      <form
        className="flex flex-col gap-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-lg font-semibold">{t.person}</legend>
          <TextField
            id="preview-invite-email"
            type="email"
            label={t.email}
            marker={t.required}
            hint={t.emailHint}
            error={t.emailTaken}
            defaultValue="s.alqahtani@alraya.example"
            dir="ltr"
            className="sm:col-span-2"
          />
          <TextField
            id="preview-invite-first"
            label={t.firstName}
            marker={t.required}
            defaultValue="نورة"
            dir="rtl"
            lang="ar"
          />
          <TextField
            id="preview-invite-family"
            label={t.familyName}
            marker={t.required}
            defaultValue="الدوسري"
            dir="rtl"
            lang="ar"
          />
          <div className="sm:col-span-2">
            <Button variant="ghost">{t.addEnglishName}</Button>
          </div>
          {(
            [
              ['department', t.department, t.noDepartment, null],
              ['manager', t.manager, t.noManager, t.managerHint],
            ] as const
          ).map(([id, label, none, hint]) => (
            <div key={id} className="flex flex-col gap-1">
              <label htmlFor={`preview-invite-${id}`} className="font-medium">
                {label}
                <span className="ms-1 font-normal text-text-muted">{t.optional}</span>
              </label>
              {hint ? (
                <p id={`preview-invite-${id}-hint`} className="m-0 text-sm text-text-muted">
                  {hint}
                </p>
              ) : null}
              <select
                id={`preview-invite-${id}`}
                aria-describedby={hint ? `preview-invite-${id}-hint` : undefined}
                className={fieldClass}
              >
                <option value="">{none}</option>
              </select>
            </div>
          ))}
        </fieldset>

        <section className="flex flex-col gap-3" aria-labelledby="preview-invite-role-heading">
          <h2 id="preview-invite-role-heading" className="m-0 text-lg font-semibold">
            {t.role}
          </h2>
          <div className="flex flex-col gap-1">
            <label htmlFor="preview-invite-role" className="text-sm font-medium">
              {t.role}
              <span className="ms-1 font-normal text-text-muted">{t.required}</span>
            </label>
            <p id="preview-invite-role-hint" className="m-0 text-sm text-text-muted">
              {t.roleHint}
            </p>
            <select
              id="preview-invite-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
              }}
              aria-describedby="preview-invite-role-hint"
              className="select-chevron min-h-9 w-full rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1"
            >
              {(['standard', 'custom'] as const).map((kind) => (
                <optgroup key={kind} label={kind === 'standard' ? t.standardGroup : t.customGroup}>
                  {t.roles
                    .filter(([, , , group]) => group === kind)
                    .map(([code, name, privileged]) => (
                      <option key={code} value={code}>
                        {privileged ? `${name} (${t.privileged})` : name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          {role === 'department_head' ? <Alert tone="info">{t.departmentsHint}</Alert> : null}
          <a href="#roles" className="text-sm">
            {t.rolesHelp}
          </a>
        </section>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-lg font-semibold">{t.language}</legend>
          <div className="flex flex-wrap gap-6">
            {(['ar', 'en'] as const).map((value) => (
              <label key={value} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="preview-invitation-locale"
                  value={value}
                  checked={language === value}
                  onChange={() => {
                    setLanguage(value);
                  }}
                  className="size-5"
                />
                <span lang={value}>{value === 'ar' ? 'العربية' : 'English'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Alert tone="info">{t.expiryNotice}</Alert>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">{t.submit}</Button>
          <a href="#users" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            {t.back}
          </a>
        </div>
      </form>
    </PreviewShell>
  );
}

export const InviteForm: Story = {
  render: (_args, { globals }) => <InviteFormPage locale={localeOf(globals)} />,
};
