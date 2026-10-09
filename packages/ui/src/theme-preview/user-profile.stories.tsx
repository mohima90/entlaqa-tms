import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import {
  PreviewShell,
  formatDateOnly,
  formatDateTime,
  localeOf,
} from '../../.storybook/theme-preview-kit';
import { Badge } from '../badge';
import { buttonClasses } from '../button';
import { Card } from '../card';

/**
 * Theme preview (T-M2-04c): the user profile (screen 3) as built —
 * apps/suite/src/app/[locale]/suite/admin/users/[personId]/page.tsx.
 */
const meta = {
  title: 'Theme preview/User profile',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const COPY = {
  ar: {
    breadcrumbLabel: 'مسار التنقل',
    breadcrumb: 'المستخدمون',
    name: 'سارة عبدالله القحطاني',
    subtitle: 'أخصائية تدريب · التدريب والتطوير · الرياض',
    status: 'نشط',
    editDetails: 'تعديل البيانات',
    basicData: 'البيانات الأساسية',
    fields: [
      ['البريد الإلكتروني', 's.alqahtani@alraya.example', 'ltr'],
      ['الجوال', '+966 55 123 4567', 'ltr'],
      ['الرقم الوظيفي', 'EMP-1187', 'ltr'],
      ['المسمى الوظيفي', 'أخصائية تدريب', null],
      ['القسم', 'التدريب والتطوير', null],
      ['الفرع', 'الرياض', null],
      ['المدير المباشر', 'خالد إبراهيم الشهري', 'link'],
      ['تاريخ التعيين', '2021-03-14', 'date'],
      ['لغة الواجهة', 'العربية', null],
      ['الاسم بالإنجليزية', 'Sarah Abdullah Alqahtani', 'ltr'],
    ],
    roles: 'الأدوار',
    roleList: [
      ['منسق التدريب', 'الدور الأساسي', true, null],
      ['مدرب داخلي', 'دور إضافي', false, 'حتى'],
    ],
    rolesAudited: 'كل تغيير في الأدوار يُسجَّل في سجل التدقيق بالقيمة قبل التغيير وبعده.',
    editRoles: 'تعديل الأدوار',
    account: 'الدخول والأمان',
    accountStatus: 'حالة الحساب',
    lastSignIn: 'آخر دخول',
    activity: 'آخر النشاط',
    events: [
      ['تغيّرت الأدوار', 'بواسطة محمد سعد العتيبي', '2026-10-07T09:20:00Z'],
      ['عُدِّلت البيانات', 'بواسطة محمد سعد العتيبي', '2026-10-02T12:45:00Z'],
      ['إجراء مسجّل (platform.user.invited)', 'بواسطة النظام', '2026-09-15T07:00:00Z'],
    ],
  },
  en: {
    breadcrumbLabel: 'Breadcrumb',
    breadcrumb: 'Users',
    name: 'Sarah Abdullah Alqahtani',
    subtitle: 'Training Specialist · Training & Development · Riyadh',
    status: 'Active',
    editDetails: 'Edit details',
    basicData: 'Basic information',
    fields: [
      ['Email', 's.alqahtani@alraya.example', 'ltr'],
      ['Mobile', '+966 55 123 4567', 'ltr'],
      ['Employee number', 'EMP-1187', 'ltr'],
      ['Job title', 'Training Specialist', null],
      ['Department', 'Training & Development', null],
      ['Branch', 'Riyadh', null],
      ['Direct manager', 'Khalid Ibrahim Alshehri', 'link'],
      ['Hire date', '2021-03-14', 'date'],
      ['Interface language', 'Arabic', null],
      ['Name in Arabic', 'سارة عبدالله القحطاني', 'rtl'],
    ],
    roles: 'Roles',
    roleList: [
      ['Training Coordinator', 'Primary role', true, null],
      ['Internal Instructor', 'Additional role', false, 'Until'],
    ],
    rolesAudited:
      'Every role change is recorded in the audit log with the values before and after the change.',
    editRoles: 'Edit roles',
    account: 'Sign-in and security',
    accountStatus: 'Account status',
    lastSignIn: 'Last sign-in',
    activity: 'Recent activity',
    events: [
      ['Roles changed', 'By Mohammed Saad Alotaibi', '2026-10-07T09:20:00Z'],
      ['Details updated', 'By Mohammed Saad Alotaibi', '2026-10-02T12:45:00Z'],
      ['Recorded action (platform.user.invited)', 'By the system', '2026-09-15T07:00:00Z'],
    ],
  },
} as const;

function value(locale: 'ar' | 'en', kind: string | null, text: string): ReactNode {
  if (kind === 'ltr' || kind === 'rtl') return <bdi dir={kind}>{text}</bdi>;
  if (kind === 'link') return <a href="#manager">{text}</a>;
  if (kind === 'date') {
    // Hire date: Gregorian, then Umm al-Qura Hijri in brackets (userProfile.hijri "({date})").
    const { gregorian, hijri } = formatDateOnly(locale, text);
    return (
      <>
        {gregorian} <span className="text-text-muted">({hijri})</span>
      </>
    );
  }
  return text;
}

/** Last day of a role, as on the profile: «حتى {date}» / "Until {date}" (medium date). */
const roleDay = (locale: 'ar' | 'en') =>
  new Intl.DateTimeFormat(`${locale}-u-nu-latn-ca-gregory`, {
    dateStyle: 'medium',
    timeZone: 'Asia/Riyadh',
  }).format(new Date('2026-12-31T12:00:00Z'));

function UserProfilePage({ locale }: { locale: 'ar' | 'en' }) {
  const t = COPY[locale];
  return (
    <PreviewShell locale={locale}>
      <nav aria-label={t.breadcrumbLabel} className="mb-2 text-sm">
        <a href="#users">{t.breadcrumb}</a>
      </nav>
      <h1 className="mb-4 mt-0 text-2xl font-bold">{t.name}</h1>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-text-muted">{t.subtitle}</p>
          <Badge tone="success">{t.status}</Badge>
          <a href="#edit" className={buttonClasses({ variant: 'secondary', className: 'ms-auto' })}>
            {t.editDetails}
          </a>
        </div>

        <Card title={t.basicData}>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {t.fields.map(([label, text, kind]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="text-sm text-text-muted">{label}</dt>
                <dd className="m-0">{value(locale, kind, text)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title={t.roles}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {t.roleList.map(([name, kind, primary, until]) => (
              <li key={name} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{name}</span>
                <Badge tone={primary ? 'info' : 'neutral'}>{kind}</Badge>
                {until ? (
                  <span className="text-sm text-text-muted">{`${until} ${roleDay(locale)}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mb-0 mt-4 text-sm text-text-muted">{t.rolesAudited}</p>
          <a href="#roles" className={buttonClasses({ variant: 'secondary', className: 'mt-4' })}>
            {t.editRoles}
          </a>
        </Card>

        <Card title={t.account}>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-text-muted">{t.accountStatus}</dt>
              <dd className="m-0">{t.status}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-text-muted">{t.lastSignIn}</dt>
              <dd className="m-0">{formatDateTime(locale, '2026-10-08T05:40:00Z')}</dd>
            </div>
          </dl>
        </Card>

        <Card title={t.activity}>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {t.events.map(([action, actor, at]) => (
              <li key={at} className="flex flex-col gap-1">
                <span className="font-medium">{action}</span>
                <span className="text-sm text-text-muted">
                  {formatDateTime(locale, at)} · {actor}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </PreviewShell>
  );
}

export const UserProfile: Story = {
  render: (_args, { globals }) => <UserProfilePage locale={localeOf(globals)} />,
};
