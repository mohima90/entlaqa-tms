import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  NotSet,
  PEOPLE,
  PreviewShell,
  type Status,
  fieldClass,
  formatDateTime,
  localeOf,
} from '../../.storybook/theme-preview-kit';
import { Alert } from '../alert';
import { Badge, type BadgeTone } from '../badge';
import { Button, buttonClasses } from '../button';

/**
 * Theme preview (T-M2-04c): the users list (screen 1) as built — apps/suite/src/app/[locale]/suite/
 * admin/users/page.tsx and components/users/invitations-table.tsx. Switch Brand, Theme and Language
 * in the toolbar to judge a theme on a real page.
 */
const meta = {
  title: 'Theme preview/Users list',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const COPY = {
  ar: {
    title: 'المستخدمون',
    inviteUser: 'دعوة مستخدم',
    summary: '128 مستخدمًا · 3 دعوات لم تُقبل بعد',
    expiredBanner:
      'انتهت صلاحية دعوتين قبل قبولهما. يمكنك إعادة إرسالهما الآن، وتبقى كل دعوة صالحة 7 أيام.',
    resendExpired: 'إعادة إرسال الدعوات المنتهية (2)',
    tabsLabel: 'حالة المستخدمين',
    tabs: { all: 'الكل', active: 'نشط', invited: 'مدعو', deactivated: 'معطّل' },
    filtersLabel: 'البحث والتصفية',
    search: 'بحث',
    searchHint: 'بالاسم أو البريد الإلكتروني أو الرقم الوظيفي',
    role: 'الدور',
    allRoles: 'كل الأدوار',
    department: 'القسم',
    allDepartments: 'كل الأقسام',
    branch: 'الفرع',
    allBranches: 'كل الفروع',
    apply: 'تطبيق',
    clearFilters: 'مسح عوامل التصفية',
    tableCaption: 'قائمة المستخدمين',
    columns: {
      name: 'الاسم',
      employeeNumber: 'الرقم الوظيفي',
      primaryRole: 'الدور الأساسي',
      department: 'القسم',
      status: 'الحالة',
      lastSignIn: 'آخر دخول',
    },
    otherRoles: 'ودور إضافي',
    status: { active: 'نشط', invited: 'مدعو', suspended: 'معطّل' },
    never: 'لم يسجّل الدخول بعد',
    noneLabel: 'غير محدد',
    paginationLabel: 'صفحات قائمة المستخدمين',
    pageRange: 'عرض 1–10 من 128',
    next: 'التالي',
    emptyFilteredTitle: 'لا توجد نتائج تطابق عوامل التصفية',
    emptyFilteredBody: 'جرّب كلمة أقصر أو ابحث بالرقم الوظيفي.',
  },
  en: {
    title: 'Users',
    inviteUser: 'Invite user',
    summary: '128 users · 3 invitations not accepted yet',
    expiredBanner:
      '2 invitations expired before they were accepted. You can resend them now; each stays valid for 7 days.',
    resendExpired: 'Resend expired invitations (2)',
    tabsLabel: 'User status',
    tabs: { all: 'All', active: 'Active', invited: 'Invited', deactivated: 'Deactivated' },
    filtersLabel: 'Search and filters',
    search: 'Search',
    searchHint: 'By name, email or employee number',
    role: 'Role',
    allRoles: 'All roles',
    department: 'Department',
    allDepartments: 'All departments',
    branch: 'Branch',
    allBranches: 'All branches',
    apply: 'Apply',
    clearFilters: 'Clear filters',
    tableCaption: 'Users list',
    columns: {
      name: 'Name',
      employeeNumber: 'Employee number',
      primaryRole: 'Primary role',
      department: 'Department',
      status: 'Status',
      lastSignIn: 'Last sign-in',
    },
    otherRoles: 'and 1 additional role',
    status: { active: 'Active', invited: 'Invited', suspended: 'Deactivated' },
    never: 'Never signed in',
    noneLabel: 'Not set',
    paginationLabel: 'Users list pages',
    pageRange: 'Showing 1–10 of 128',
    next: 'Next',
    emptyFilteredTitle: 'No results match the filters',
    emptyFilteredBody: 'Try a shorter word or search by employee number.',
  },
} as const;

const STATUS_TONE: Record<Status, BadgeTone> = {
  active: 'success',
  invited: 'info',
  suspended: 'neutral',
};
const TABS = ['all', 'active', 'invited', 'deactivated'] as const;
const COUNTS = { all: 128, active: 117, invited: 5, deactivated: 6 } as const;

function UsersListPage({ locale, empty = false }: { locale: 'ar' | 'en'; empty?: boolean }) {
  const t = COPY[locale];
  const th = 'px-4 py-3 text-start font-semibold';
  return (
    <PreviewShell locale={locale}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
        <a href="#invite" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t.inviteUser}
        </a>
      </div>
      <div className="flex flex-col gap-6">
        <p className="m-0 text-text-muted">{t.summary}</p>

        <div className="flex flex-col gap-2">
          <Alert tone="warning">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 basis-80">{t.expiredBanner}</span>
              <Button variant="secondary">{t.resendExpired}</Button>
            </div>
          </Alert>
        </div>

        <nav aria-label={t.tabsLabel}>
          <ul className="m-0 flex list-none flex-wrap gap-2 border-b border-border p-0">
            {TABS.map((tab) => (
              <li key={tab}>
                <a
                  href={`#${tab}`}
                  aria-current={tab === 'all' ? 'page' : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 no-underline ${
                    tab === 'all'
                      ? 'border-primary font-semibold text-primary-text'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  {t.tabs[tab]}
                  <Badge>{COUNTS[tab]}</Badge>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <form
          aria-label={t.filtersLabel}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div className="flex flex-col gap-1 xl:col-span-2">
            <label htmlFor="preview-users-q" className="font-medium">
              {t.search}
            </label>
            <input
              id="preview-users-q"
              type="search"
              defaultValue={empty ? 'zzz' : ''}
              aria-describedby="preview-users-q-hint"
              className={fieldClass}
            />
            <p id="preview-users-q-hint" className="m-0 text-sm text-text-muted">
              {t.searchHint}
            </p>
          </div>
          {(
            [
              ['role', t.role, t.allRoles],
              ['department', t.department, t.allDepartments],
              ['branch', t.branch, t.allBranches],
            ] as const
          ).map(([id, label, all]) => (
            <div key={id} className="flex flex-col gap-1">
              <label htmlFor={`preview-users-${id}`} className="font-medium">
                {label}
              </label>
              <select id={`preview-users-${id}`} className={fieldClass}>
                <option value="">{all}</option>
              </select>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 xl:col-span-5">
            <button type="submit" className={buttonClasses({ variant: 'primary', size: 'md' })}>
              {t.apply}
            </button>
            {empty ? (
              <a href="#clear" className={buttonClasses({ variant: 'ghost', size: 'md' })}>
                {t.clearFilters}
              </a>
            ) : null}
          </div>
        </form>

        {empty ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-center">
            <h2 className="m-0 text-lg font-semibold">{t.emptyFilteredTitle}</h2>
            <p className="mb-0 mt-2 text-text-muted">{t.emptyFilteredBody}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full border-collapse text-start">
                <caption className="sr-only">{t.tableCaption}</caption>
                <thead className="bg-surface-sunken text-sm">
                  <tr>
                    <th scope="col" className={th}>
                      {t.columns.name}
                    </th>
                    <th scope="col" className={th}>
                      {t.columns.employeeNumber}
                    </th>
                    <th scope="col" className={th}>
                      {t.columns.primaryRole}
                    </th>
                    <th scope="col" className={th}>
                      {t.columns.department}
                    </th>
                    <th scope="col" className={th}>
                      {t.columns.status}
                    </th>
                    <th scope="col" className={th}>
                      {t.columns.lastSignIn}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PEOPLE.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <a href={`#${p.id}`} className="font-medium">
                          {p.name[locale]}
                        </a>
                        <div className="text-sm text-text-muted">
                          <bdi dir="ltr">{p.email}</bdi>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.employeeNumber ? (
                          <bdi dir="ltr">{p.employeeNumber}</bdi>
                        ) : (
                          <NotSet label={t.noneLabel} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.role[locale]}
                        {p.otherRoles > 0 ? (
                          <div className="text-sm text-text-muted">{t.otherRoles}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {p.department ? p.department[locale] : <NotSet label={t.noneLabel} />}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[p.status]}>{t.status[p.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {p.lastSignIn ? formatDateTime(locale, p.lastSignIn) : t.never}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav
              aria-label={t.paginationLabel}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <p className="m-0 text-sm text-text-muted">{t.pageRange}</p>
              <div className="flex gap-2">
                <a
                  href="#next"
                  rel="next"
                  className={buttonClasses({ variant: 'secondary', size: 'md' })}
                >
                  {t.next}
                </a>
              </div>
            </nav>
          </>
        )}
      </div>
    </PreviewShell>
  );
}

export const UsersList: Story = {
  render: (_args, { globals }) => <UsersListPage locale={localeOf(globals)} />,
};

export const NoResults: Story = {
  render: (_args, { globals }) => <UsersListPage locale={localeOf(globals)} empty />,
};
