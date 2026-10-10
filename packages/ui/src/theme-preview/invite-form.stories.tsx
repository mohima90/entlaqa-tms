import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PreviewShell, fieldClass, localeOf } from '../../.storybook/theme-preview-kit';
import { Alert } from '../alert';
import { Badge } from '../badge';
import { Button, buttonClasses } from '../button';
import { TextField } from '../text-field';

/**
 * Theme preview (T-M2-04c): the invite form (screen 2) as built — form patterns of
 * apps/suite/src/components/users/invite-user-form.tsx (text fields, selects, role cards, role
 * chips, radio buttons, an error and an info message).
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
    primaryRole: 'الدور الأساسي',
    primaryRoleHint:
      'يحدد الدور الأساسي الصفحة الرئيسية وما يراه الشخص أولًا. للمستخدم دور أساسي واحد.',
    privileged: 'دور مميز',
    additionalRoles: 'أدوار إضافية',
    additionalRolesHint: 'الصلاحيات الفعلية هي مجموع صلاحيات الدور الأساسي والأدوار الإضافية.',
    language: 'لغة رسالة الدعوة',
    expiryNotice:
      'تبقى الدعوة صالحة 7 أيام (حتى 16 أكتوبر 2026). يمكنك إعادة إرسالها حتى 3 مرات أو إلغاؤها من قائمة المستخدمين.',
    submit: 'إرسال الدعوة',
    back: 'رجوع',
    roles: [
      [
        'training_coordinator',
        'منسق التدريب',
        'تشغيل الجلسات يوميًا: الجدولة والتجهيزات والحضور.',
        false,
      ],
      [
        'training_manager',
        'مدير التدريب',
        'الخطط ودليل الدورات والجلسات والموارد والتسجيلات والتقارير.',
        false,
      ],
      ['line_manager', 'المدير المباشر', 'طلبات الفريق المباشر وترشيحاته والموافقة عليها.', false],
      [
        'hr_manager',
        'مدير الموارد البشرية',
        'سجلات الموظفين والتدريب الإلزامي والامتثال، ودعوة المستخدمين وإسناد الأدوار غير المميزة.',
        true,
      ],
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
    primaryRole: 'Primary role',
    primaryRoleHint:
      'The primary role sets the home page and what the person sees first. A user has one primary role.',
    privileged: 'Privileged role',
    additionalRoles: 'Additional roles',
    additionalRolesHint:
      'The effective permissions are those of the primary role plus the additional roles.',
    language: 'Invitation email language',
    expiryNotice:
      'The invitation stays valid for 7 days (until 16 Oct 2026). You can resend it up to 3 times or revoke it from the users list.',
    submit: 'Send invitation',
    back: 'Go back',
    roles: [
      [
        'training_coordinator',
        'Training Coordinator',
        'Day-to-day session operations: scheduling, logistics and attendance.',
        false,
      ],
      [
        'training_manager',
        'Training Manager',
        'Plans, catalog, sessions, resources, enrollments and reports.',
        false,
      ],
      [
        'line_manager',
        'Line Manager',
        'Direct reports’ requests, nominations and approvals.',
        false,
      ],
      [
        'hr_manager',
        'HR Manager',
        'Employee records, mandatory training and compliance; invites users and gives non-privileged roles.',
        true,
      ],
    ],
  },
} as const;

/** A role card's text (invite-user-form.tsx `roleText`). */
function RoleText({
  name,
  description,
  privileged,
}: {
  readonly name: string;
  readonly description: string;
  readonly privileged: string | null;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        <span>{name}</span>
        {privileged ? <Badge tone="warning">{privileged}</Badge> : null}
      </span>
      <span className="text-sm text-text-muted">{description}</span>
    </span>
  );
}

function InviteFormPage({ locale }: { locale: 'ar' | 'en' }) {
  const t = COPY[locale];
  const [primary, setPrimary] = useState('training_coordinator');
  const [additional, setAdditional] = useState<string[]>(['line_manager']);
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

        <fieldset
          className="m-0 flex flex-col gap-3 border-0 p-0"
          aria-describedby="preview-invite-primary-hint"
        >
          <legend className="mb-1 text-lg font-semibold">
            {t.primaryRole}{' '}
            <span className="text-base font-normal text-text-muted">{t.required}</span>
          </legend>
          <p id="preview-invite-primary-hint" className="m-0 text-sm text-text-muted">
            {t.primaryRoleHint}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {t.roles.map(([code, name, description, privileged]) => (
              <label
                key={code}
                className={`flex min-h-11 items-start gap-3 rounded-md border p-3 ${
                  primary === code ? 'border-primary bg-primary-subtle' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="preview-primary-role"
                  value={code}
                  checked={primary === code}
                  onChange={() => {
                    setPrimary(code);
                  }}
                  className="mt-1 size-5 shrink-0"
                />
                <RoleText
                  name={name}
                  description={description}
                  privileged={privileged ? t.privileged : null}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset
          className="m-0 flex flex-col gap-3 border-0 p-0"
          aria-describedby="preview-invite-additional-hint"
        >
          <legend className="mb-1 text-lg font-semibold">
            {t.additionalRoles}{' '}
            <span className="text-base font-normal text-text-muted">{t.optional}</span>
          </legend>
          <p id="preview-invite-additional-hint" className="m-0 text-sm text-text-muted">
            {t.additionalRolesHint}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {t.roles
              .filter(([code]) => code !== primary)
              .map(([code, name]) => {
                const on = additional.includes(code);
                return (
                  <li key={code}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setAdditional((list) =>
                          on ? list.filter((c) => c !== code) : [...list, code],
                        );
                      }}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 ${
                        on
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-border-strong bg-surface text-text hover:bg-surface-hover'
                      }`}
                    >
                      {on ? (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          aria-hidden="true"
                        >
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      ) : null}
                      {name}
                    </button>
                  </li>
                );
              })}
          </ul>
        </fieldset>

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
