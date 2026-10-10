import type { ReactNode } from 'react';
import { AppShell } from '../src/app-shell';
import { buttonClasses } from '../src/button';
import { NavItem, NavUnavailable, navHeadingClasses } from '../src/nav-item';

/**
 * Theme preview kit (T-M2-04c): the users pages as built in apps/suite, redrawn with @jadarat/ui so a
 * theme can be judged on real screens in Storybook. Copy is the product's own (packages/platform-i18n
 * messages, namespaces common/shell/users/userProfile/invitations — copied here because packages/ui
 * may not import platform packages, ADR 0001); people are the sample data of approved screen 1
 * (docs/design/screens/m2-users-roles/Main.dc.html). Page markup mirrors:
 *   apps/suite/src/components/suite-shell.tsx
 *   apps/suite/src/app/[locale]/suite/admin/users/page.tsx
 *   apps/suite/src/app/[locale]/suite/admin/users/[personId]/page.tsx
 *   apps/suite/src/components/users/{invitations-table,invite-user-form}.tsx
 * When those pages change, update this kit (until the round moves their patterns into @jadarat/ui —
 * docs/design/visual-round-checklist.md). Differences on purpose: navigation entries use NavItem and
 * header text the header roles, which the app adopts in the round.
 */
export type Locale = 'ar' | 'en';

export const localeOf = (globals: Record<string, unknown>): Locale =>
  globals.locale === 'en' ? 'en' : 'ar';

/** Same formats as the app (platform-i18n: Gregorian calendar, Western digits, medium + short). */
export function formatDateTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn-ca-gregory`, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(iso));
}

/** A date-only value as the profile shows it: Gregorian (long) and Umm al-Qura Hijri (formatHijriDate). */
export function formatDateOnly(locale: Locale, ymd: string): { gregorian: string; hijri: string } {
  const date = new Date(`${ymd}T00:00:00Z`);
  return {
    gregorian: new Intl.DateTimeFormat(`${locale}-u-nu-latn-ca-gregory`, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(date),
    hijri: new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date),
  };
}

const SHELL = {
  ar: {
    productName: 'جدارات · التدريب',
    skipToContent: 'تخطَّ إلى المحتوى',
    mainNavigation: 'التنقل الرئيسي',
    home: 'الرئيسية',
    calendar: 'التقويم',
    sessions: 'الجلسات',
    courses: 'الدورات',
    comingSoon: 'قريبًا',
    admin: 'إدارة المنشأة',
    users: 'المستخدمون',
    roles: 'الأدوار والصلاحيات',
    tenantContext: 'المنشأة',
    tenantName: 'شركة الراية',
    switchLanguage: 'English',
    switchLanguageAria: 'التبديل إلى اللغة الإنجليزية',
    myProfile: 'ملفي الشخصي',
    me: 'محمد سعد العتيبي',
    signOut: 'تسجيل الخروج',
  },
  en: {
    productName: 'Jadarat · Training',
    skipToContent: 'Skip to content',
    mainNavigation: 'Main navigation',
    home: 'Home',
    calendar: 'Calendar',
    sessions: 'Sessions',
    courses: 'Courses',
    comingSoon: 'Coming soon',
    admin: 'Organization admin',
    users: 'Users',
    roles: 'Roles & permissions',
    tenantContext: 'Organization',
    tenantName: 'Al Raya Company',
    switchLanguage: 'العربية',
    switchLanguageAria: 'Switch to Arabic',
    myProfile: 'My profile',
    me: 'Mohammed Saad Alotaibi',
    signOut: 'Sign out',
  },
} as const;

/** The suite shell as the app draws it for an Organization Admin on the users pages. */
export function PreviewShell({
  locale,
  current = 'users',
  children,
}: {
  readonly locale: Locale;
  readonly current?: 'home' | 'users' | 'roles';
  readonly children: ReactNode;
}) {
  const t = SHELL[locale];
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <AppShell
      brand={t.productName}
      navigationLabel={t.mainNavigation}
      skipToContentLabel={t.skipToContent}
      navigation={
        <>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <li>
              <NavItem href="#home" current={current === 'home'}>
                {t.home}
              </NavItem>
            </li>
            {([t.calendar, t.sessions, t.courses] as const).map((label) => (
              <li key={label}>
                <NavUnavailable label={label} note={t.comingSoon} />
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <h2 id="preview-nav-admin" className={navHeadingClasses}>
              {t.admin}
            </h2>
            <ul
              aria-labelledby="preview-nav-admin"
              className="m-0 flex list-none flex-col gap-1 p-0"
            >
              <li>
                <NavItem href="#users" current={current === 'users'}>
                  {t.users}
                </NavItem>
              </li>
              <li>
                <NavItem href="#roles" current={current === 'roles'}>
                  {t.roles}
                </NavItem>
              </li>
            </ul>
          </div>
        </>
      }
      headerEnd={
        <>
          <span className="hidden text-sm text-on-header-muted md:inline">
            {t.tenantContext}: {t.tenantName}
          </span>
          <a
            href="#language"
            hrefLang={other}
            lang={other}
            aria-label={t.switchLanguageAria}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            {t.switchLanguage}
          </a>
          <a
            href="#profile"
            className="flex min-h-11 items-center gap-2 rounded-full px-1 text-on-header no-underline hover:bg-surface-hover"
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-primary font-semibold text-on-primary"
            >
              {Array.from(t.me)[0]}
            </span>
            <span className="sr-only">{t.myProfile}: </span>
            <span className="hidden max-w-40 truncate text-sm lg:inline">{t.me}</span>
          </a>
          <button type="button" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            {t.signOut}
          </button>
        </>
      }
    >
      {children}
    </AppShell>
  );
}

/** An empty value: a dash on screen, words for screen readers (apps/suite/src/components/not-set.tsx). */
export function NotSet({ label }: { readonly label: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-text-muted">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Field classes of the users-list filters (users/page.tsx `fieldClass`). */
export const fieldClass =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text';

export type Status = 'active' | 'invited' | 'suspended';

export interface SamplePerson {
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string };
  readonly email: string;
  readonly employeeNumber: string | null;
  readonly role: { readonly ar: string; readonly en: string };
  readonly otherRoles: number;
  readonly department: { readonly ar: string; readonly en: string } | null;
  readonly status: Status;
  readonly lastSignIn: string | null;
}

const D = {
  hr: { ar: 'الموارد البشرية', en: 'Human Resources' },
  td: { ar: 'التدريب والتطوير', en: 'Training & Development' },
  ops: { ar: 'العمليات', en: 'Operations' },
  cs: { ar: 'خدمة العملاء', en: 'Customer Service' },
  fin: { ar: 'المالية', en: 'Finance' },
  sales: { ar: 'المبيعات', en: 'Sales' },
  qa: { ar: 'الجودة', en: 'Quality' },
} as const;

/** Sample people of approved screen 1 (names, e-mails and numbers are sample data). */
export const PEOPLE: readonly SamplePerson[] = [
  {
    id: 'p1',
    name: { ar: 'محمد سعد العتيبي', en: 'Mohammed Saad Alotaibi' },
    email: 'm.alotaibi@alraya.example',
    employeeNumber: 'EMP-1001',
    role: { ar: 'مدير المنشأة', en: 'Organization Admin' },
    otherRoles: 0,
    department: D.hr,
    status: 'active',
    lastSignIn: '2026-10-08T06:12:00Z',
  },
  {
    id: 'p2',
    name: { ar: 'سارة عبدالله القحطاني', en: 'Sarah Abdullah Alqahtani' },
    email: 's.alqahtani@alraya.example',
    employeeNumber: 'EMP-1187',
    role: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    otherRoles: 1,
    department: D.td,
    status: 'active',
    lastSignIn: '2026-10-08T05:40:00Z',
  },
  {
    id: 'p3',
    name: { ar: 'خالد إبراهيم الشهري', en: 'Khalid Ibrahim Alshehri' },
    email: 'k.alshehri@alraya.example',
    employeeNumber: 'EMP-1042',
    role: { ar: 'مدير التدريب', en: 'Training Manager' },
    otherRoles: 0,
    department: D.td,
    status: 'active',
    lastSignIn: '2026-10-07T11:05:00Z',
  },
  {
    id: 'p4',
    name: { ar: 'نورة فهد الدوسري', en: 'Noura Fahad Aldossari' },
    email: 'n.aldossari@alraya.example',
    employeeNumber: null,
    role: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    otherRoles: 0,
    department: D.td,
    status: 'invited',
    lastSignIn: null,
  },
  {
    id: 'p5',
    name: { ar: 'عبدالرحمن علي الزهراني', en: 'Abdulrahman Ali Alzahrani' },
    email: 'a.alzahrani@alraya.example',
    employeeNumber: 'EMP-1310',
    role: { ar: 'المدير المباشر', en: 'Line Manager' },
    otherRoles: 0,
    department: D.ops,
    status: 'active',
    lastSignIn: '2026-10-06T08:30:00Z',
  },
  {
    id: 'p6',
    name: { ar: 'ريم ناصر الحربي', en: 'Reem Nasser Alharbi' },
    email: 'r.alharbi@alraya.example',
    employeeNumber: 'EMP-1422',
    role: { ar: 'متدرب', en: 'Learner' },
    otherRoles: 0,
    department: D.cs,
    status: 'active',
    lastSignIn: '2026-10-05T14:20:00Z',
  },
  {
    id: 'p7',
    name: { ar: 'فاطمة يوسف المالكي', en: 'Fatimah Yousef Almalki' },
    email: 'f.almalki@alraya.example',
    employeeNumber: 'EMP-1105',
    role: { ar: 'المدير المالي', en: 'Finance Manager' },
    otherRoles: 0,
    department: D.fin,
    status: 'suspended',
    lastSignIn: '2026-09-21T09:00:00Z',
  },
  {
    id: 'p8',
    name: { ar: 'يوسف عمر الغامدي', en: 'Yousef Omar Alghamdi' },
    email: 'y.alghamdi@alraya.example',
    employeeNumber: 'EMP-0988',
    role: { ar: 'رئيس القسم', en: 'Department Head' },
    otherRoles: 0,
    department: D.sales,
    status: 'active',
    lastSignIn: '2026-10-08T07:55:00Z',
  },
  {
    id: 'p9',
    name: { ar: 'هند سالم العنزي', en: 'Hind Salem Alanazi' },
    email: 'h.alanazi@alraya.example',
    employeeNumber: 'EMP-1250',
    role: { ar: 'مدرب داخلي', en: 'Internal Instructor' },
    otherRoles: 0,
    department: D.qa,
    status: 'active',
    lastSignIn: null,
  },
  {
    id: 'p10',
    name: { ar: 'أحمد حسن منصور', en: 'Ahmed Hassan Mansour' },
    email: 'ahmed.mansour@trainpro.example',
    employeeNumber: null,
    role: { ar: 'مدرب خارجي', en: 'External Instructor' },
    otherRoles: 0,
    department: null,
    status: 'invited',
    lastSignIn: null,
  },
];
