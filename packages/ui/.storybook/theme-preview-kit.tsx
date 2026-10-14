import type { ReactNode } from 'react';
import { AppShell } from '../src/app-shell';
import { buttonClasses } from '../src/button';
import { Icon, type IconName } from '../src/icons';
import { NavGroup, NavItem, NavUnavailable } from '../src/nav-item';

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
    menu: 'القائمة',
    closeMenu: 'إغلاق القائمة',
    home: 'الرئيسية',
    comingSoon: 'قريبًا',
    groupOrganization: 'المنشأة',
    organizationProfile: 'بيانات المنشأة',
    branding: 'الهوية البصرية',
    customFields: 'الحقول المخصصة',
    featuresPlan: 'الميزات والاشتراك',
    groupDomains: 'إدارة النطاقات',
    domains: 'النطاقات',
    groupPeople: 'الأشخاص',
    users: 'المستخدمون',
    roles: 'الأدوار والصلاحيات',
    groupSecurity: 'الأمان',
    securityPolicy: 'سياسة الأمان',
    auditLog: 'سجل التدقيق',
    consent: 'موافقات الخصوصية',
    groupEmail: 'إرسال البريد الإلكتروني',
    emailSender: 'بيانات المُرسِل',
    groupIntegrations: 'التكاملات',
    lmsConnection: 'ربط نظام إدارة التعلّم',
    hrSystem: 'نظام الموارد البشرية',
    tenantContext: 'المنشأة',
    tenantName: 'شركة الراية',
    switchLanguage: 'English',
    switchLanguageAria: 'التبديل إلى اللغة الإنجليزية',
    myProfile: 'ملفي الشخصي',
    me: 'محمد سعد العتيبي',
    signOut: 'تسجيل الخروج',
  },
  en: {
    productName: 'Jadarat TMS',
    skipToContent: 'Skip to content',
    mainNavigation: 'Main navigation',
    menu: 'Menu',
    closeMenu: 'Close menu',
    home: 'Home',
    comingSoon: 'Coming soon',
    groupOrganization: 'Organization',
    organizationProfile: 'Organization profile',
    branding: 'Branding',
    customFields: 'Custom fields',
    featuresPlan: 'Features & plan',
    groupDomains: 'Domain management',
    domains: 'Domains',
    groupPeople: 'People',
    users: 'Users',
    roles: 'Roles & permissions',
    groupSecurity: 'Security',
    securityPolicy: 'Security policy',
    auditLog: 'Audit log',
    consent: 'Consent',
    groupEmail: 'E-mail sending',
    emailSender: 'Sender settings',
    groupIntegrations: 'Integrations',
    lmsConnection: 'LMS connection',
    hrSystem: 'HR system',
    tenantContext: 'Organization',
    tenantName: 'Al Raya Company',
    switchLanguage: 'العربية',
    switchLanguageAria: 'Switch to Arabic',
    myProfile: 'My profile',
    me: 'Mohammed Saad Alotaibi',
    signOut: 'Sign out',
  },
} as const;

type ShellKey = keyof (typeof SHELL)['en'];
type PreviewPage = 'home' | 'users' | 'roles' | 'security';

/** The Organization Admin's menu (apps/suite/src/lib/suite-navigation.ts; BRD v2.9). */
const ADMIN_MENU: readonly {
  readonly heading?: ShellKey;
  readonly entries: readonly { key: ShellKey; icon: IconName; page?: PreviewPage }[];
}[] = [
  { entries: [{ key: 'home', icon: 'home', page: 'home' }] },
  {
    heading: 'groupOrganization',
    entries: [
      { key: 'organizationProfile', icon: 'building' },
      { key: 'branding', icon: 'palette' },
      { key: 'customFields', icon: 'fields' },
      { key: 'featuresPlan', icon: 'plan' },
    ],
  },
  { heading: 'groupDomains', entries: [{ key: 'domains', icon: 'globe' }] },
  {
    heading: 'groupPeople',
    entries: [
      { key: 'users', icon: 'people', page: 'users' },
      { key: 'roles', icon: 'key', page: 'roles' },
    ],
  },
  {
    heading: 'groupSecurity',
    entries: [
      { key: 'securityPolicy', icon: 'shield', page: 'security' },
      { key: 'auditLog', icon: 'audit' },
      { key: 'consent', icon: 'consent' },
    ],
  },
  { heading: 'groupEmail', entries: [{ key: 'emailSender', icon: 'mail' }] },
  {
    heading: 'groupIntegrations',
    entries: [
      { key: 'lmsConnection', icon: 'plug' },
      { key: 'hrSystem', icon: 'sync' },
    ],
  },
];

/** The suite shell as the app draws it for an Organization Admin (approved design, T-M2-21). */
export function PreviewShell({
  locale,
  current = 'users',
  children,
}: {
  readonly locale: Locale;
  readonly current?: PreviewPage;
  readonly children: ReactNode;
}) {
  const t = SHELL[locale];
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <AppShell
      brand={t.productName}
      organization={
        <>
          <span className="sr-only">{t.tenantContext}: </span>
          {t.tenantName}
        </>
      }
      navigationLabel={t.mainNavigation}
      skipToContentLabel={t.skipToContent}
      menuLabel={t.menu}
      closeMenuLabel={t.closeMenu}
      navigation={ADMIN_MENU.map((group) => (
        <NavGroup
          key={group.heading ?? 'main'}
          id={group.heading ? `preview-nav-${group.heading}` : undefined}
          heading={group.heading ? t[group.heading] : undefined}
        >
          {group.entries.map((entry) => (
            <li key={entry.key}>
              {entry.page ? (
                <NavItem
                  href={`#${entry.page}`}
                  current={current === entry.page}
                  icon={<Icon name={entry.icon} />}
                >
                  {t[entry.key]}
                </NavItem>
              ) : (
                <NavUnavailable
                  label={t[entry.key]}
                  note={t.comingSoon}
                  icon={<Icon name={entry.icon} />}
                />
              )}
            </li>
          ))}
        </NavGroup>
      ))}
      headerEnd={
        <>
          <a
            href="#language"
            hrefLang={other}
            lang={other}
            aria-label={t.switchLanguageAria}
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover hover:text-text"
          >
            <Icon name="globe" />
            {t.switchLanguage}
          </a>
          <a
            href="#profile"
            className="flex min-h-11 items-center gap-2 rounded-md px-1.5 text-on-header no-underline hover:bg-surface-hover"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text"
            >
              {Array.from(t.me)[0]}
            </span>
            <span className="sr-only">{t.myProfile}: </span>
            <span className="hidden max-w-40 truncate text-sm font-medium lg:inline">{t.me}</span>
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
    role: { ar: 'مدير التعلم والتطوير', en: 'L&D Manager' },
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
