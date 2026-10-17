import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoShell } from '../.storybook/demo-shell';
import { type Copy, pick } from '../.storybook/l10n';
import { Avatar } from './avatar';
import { Badge, type BadgeTone } from './badge';
import { buttonClasses } from './button';
import { Card } from './card';
import { Icon, type IconName } from './icons';
import { PageHeader } from './page-header';
import { StatCard, StatGrid } from './stat-card';
import { TabNav } from './tab-nav';
import { tableClasses } from './table';
import { TextField } from './text-field';
import { toolbarFieldClasses } from './toolbar';

/**
 * The Organization Admin's pages as the app renders them (T-M2-43 Kawadir polish), in the shell with
 * sample data — for reviewing the screens with the PO and comparing them with Kawadir ATS. The markup
 * follows apps/suite: the home (`/suite`), Team members (`/suite/admin/users`) and Settings → General
 * (`/suite/admin/settings`). Sample names and figures only. Colours are Jadarat's by default (PO,
 * 16 Oct 2026); tagged `brand-matrix`, the story gate also runs the pages with organization colours,
 * which replace the brand gradient everywhere (FR-ADM-07).
 */
const meta = {
  title: 'Pages/Organization Admin',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen', frame: 'bare' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

type Globals = Record<string, unknown>;

const STATS = {
  total: { ar: 'إجمالي الأعضاء', en: 'Total members' },
  active: { ar: 'نشط', en: 'Active' },
  pending: { ar: 'الدعوات المعلّقة', en: 'Pending invites' },
  deactivated: { ar: 'معطَّل', en: 'Deactivated' },
} as const satisfies Record<string, Copy>;

function TeamFigures({ globals }: { globals: Globals }) {
  return (
    <StatGrid label={pick(globals, { ar: 'ملخص', en: 'Summary' })} className="mb-6">
      <StatCard variant="gradient" label={pick(globals, STATS.total)} value="24" icon="people" />
      <StatCard variant="gradient" label={pick(globals, STATS.active)} value="19" icon="success" />
      <StatCard variant="gradient" label={pick(globals, STATS.pending)} value="3" icon="mail" />
      <StatCard variant="gradient" label={pick(globals, STATS.deactivated)} value="2" icon="user" />
    </StatGrid>
  );
}

const SETUP_LINKS: readonly { key: string; icon: IconName; label: Copy }[] = [
  { key: 'team', icon: 'people', label: { ar: 'أعضاء الفريق', en: 'Team members' } },
  { key: 'roles', icon: 'key', label: { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' } },
  { key: 'general', icon: 'settings', label: { ar: 'الإعدادات العامة', en: 'General' } },
  { key: 'security', icon: 'shield', label: { ar: 'الأمان', en: 'Security' } },
];

/** The Organization Admin home (`/suite`): gradient title, the team's KPI cards, the set-up card. */
export const OrgAdminHome: Story = {
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="home" title={{ ar: 'الرئيسية', en: 'Home' }}>
      <PageHeader
        title={pick(globals, { ar: 'الرئيسية', en: 'Home' })}
        description={pick(globals, {
          ar: 'نظرة عامة على منشأتك.',
          en: 'Your organization at a glance.',
        })}
        gradient
      />
      <TeamFigures globals={globals} />
      <Card
        title={pick(globals, { ar: 'إعداد منشأتك', en: 'Set up your organization' })}
        description={pick(globals, {
          ar: 'يمكنك إكمال الإعدادات العامة ودعوة أعضاء الفريق ومراجعة أدوارهم وضبط سياسة الأمان. وستتوفر صفحات إعداد أخرى قريبًا.',
          en: 'Fill in your general settings, invite your team members, check their roles and set your security policy. More set-up pages are coming soon.',
        })}
        icon="settings"
      >
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-4">
          {SETUP_LINKS.map((entry) => (
            <li key={entry.key}>
              <a
                href={`#${entry.key}`}
                className="group flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 font-medium text-text no-underline shadow-1 transition-colors hover:border-border-strong hover:bg-surface-hover"
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary-text"
                >
                  <Icon name={entry.icon} className="size-5" />
                </span>
                <span className="min-w-0 flex-1">{pick(globals, entry.label)}</span>
                <Icon name="chevron-end" className="text-text-muted" />
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </DemoShell>
  ),
};

const PEOPLE: readonly {
  ar: string;
  en: string;
  email: string;
  number: string;
  role: Copy;
  department: Copy;
  status: 'active' | 'invited' | 'suspended';
  last: Copy;
}[] = [
  {
    ar: 'منيرة القحطاني',
    en: 'Munira Alqahtani',
    email: 'munira@raya.example',
    number: 'E-1001',
    role: { ar: 'مدير المنظمة', en: 'Organization Admin' },
    department: { ar: 'الموارد البشرية', en: 'Human Resources' },
    status: 'active',
    last: { ar: '16 أكتوبر 2026، 09:12', en: '16 Oct 2026, 09:12' },
  },
  {
    ar: 'خالد العتيبي',
    en: 'Khalid Alotaibi',
    email: 'khalid@raya.example',
    number: 'E-1002',
    role: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    department: { ar: 'الموارد البشرية', en: 'Human Resources' },
    status: 'active',
    last: { ar: '15 أكتوبر 2026، 14:40', en: '15 Oct 2026, 14:40' },
  },
  {
    ar: 'نورة الشمري',
    en: 'Noura Alshammari',
    email: 'noura@raya.example',
    number: 'E-1017',
    role: { ar: 'مدير التعلم والتطوير', en: 'L&D Manager' },
    department: { ar: 'التعلم والتطوير', en: 'Learning & Development' },
    status: 'active',
    last: { ar: '15 أكتوبر 2026، 11:05', en: '15 Oct 2026, 11:05' },
  },
  {
    ar: 'فهد الدوسري',
    en: 'Fahad Aldosari',
    email: 'fahad@raya.example',
    number: 'E-1023',
    role: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    department: { ar: 'التعلم والتطوير', en: 'Learning & Development' },
    status: 'active',
    last: { ar: '14 أكتوبر 2026، 16:22', en: '14 Oct 2026, 16:22' },
  },
  {
    ar: 'ريم الزهراني',
    en: 'Reem Alzahrani',
    email: 'reem@raya.example',
    number: 'E-1031',
    role: { ar: 'رئيس قسم', en: 'Department Head' },
    department: { ar: 'المالية', en: 'Finance' },
    status: 'active',
    last: { ar: '12 أكتوبر 2026، 08:47', en: '12 Oct 2026, 08:47' },
  },
  {
    ar: 'عبدالله الحربي',
    en: 'Abdullah Alharbi',
    email: 'abdullah@raya.example',
    number: 'E-1044',
    role: { ar: 'موظف', en: 'Employee' },
    department: { ar: 'المبيعات', en: 'Sales' },
    status: 'invited',
    last: { ar: 'لم يسجّل الدخول بعد', en: 'Never signed in' },
  },
  {
    ar: 'سارة المطيري',
    en: 'Sara Almutairi',
    email: 'sara@raya.example',
    number: 'E-1052',
    role: { ar: 'موظف', en: 'Employee' },
    department: { ar: 'المبيعات', en: 'Sales' },
    status: 'suspended',
    last: { ar: '2 سبتمبر 2026، 10:30', en: '2 Sep 2026, 10:30' },
  },
];

const STATUS: Record<(typeof PEOPLE)[number]['status'], { tone: BadgeTone; label: Copy }> = {
  active: { tone: 'success', label: { ar: 'نشط', en: 'Active' } },
  invited: { tone: 'info', label: { ar: 'مدعو', en: 'Invited' } },
  suspended: { tone: 'neutral', label: { ar: 'معطّل', en: 'Deactivated' } },
};

/** Team members (`/suite/admin/users`, Kawadir Candidates): KPI cards, tabs, filters, the table. */
export const TeamMembers: Story = {
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="team" title={{ ar: 'أعضاء الفريق', en: 'Team members' }}>
      <PageHeader
        title={pick(globals, { ar: 'أعضاء الفريق', en: 'Team members' })}
        description={pick(globals, {
          ar: 'أعضاء منشأتك وأدوارهم والدعوات التي لم تُقبل بعد.',
          en: 'The people of your organization, their roles and the invitations not accepted yet.',
        })}
        actions={
          <>
            <a href="#import" className={buttonClasses({ variant: 'secondary' })}>
              {pick(globals, { ar: 'استيراد من ملف', en: 'Import from file' })}
            </a>
            <a href="#invite" className={buttonClasses({ variant: 'primary' })}>
              <Icon name="user-plus" />
              {pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
            </a>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <TeamFigures globals={globals} />
        <TabNav
          label={pick(globals, { ar: 'عرض أعضاء الفريق', en: 'Team members views' })}
          current="members"
          className="-mt-6"
          items={[
            {
              key: 'members',
              href: '#members',
              icon: 'people',
              label: pick(globals, { ar: 'الأعضاء', en: 'Members' }),
              count: '24',
            },
            {
              key: 'invited',
              href: '#invited',
              icon: 'mail',
              label: pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' }),
              count: '3',
            },
          ]}
        />
        <form
          role="search"
          aria-label={pick(globals, { ar: 'البحث والتصفية', en: 'Search and filters' })}
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
        >
          <div className="flex flex-col gap-1 xl:col-span-2">
            <label htmlFor="story-users-q" className="text-sm font-medium">
              {pick(globals, { ar: 'بحث', en: 'Search' })}
            </label>
            <input id="story-users-q" type="search" className={toolbarFieldClasses} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="story-users-role" className="text-sm font-medium">
              {pick(globals, { ar: 'الدور', en: 'Role' })}
            </label>
            <select id="story-users-role" className={`${toolbarFieldClasses} select-chevron pe-10`}>
              <option>{pick(globals, { ar: 'كل الأدوار', en: 'All roles' })}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="story-users-department" className="text-sm font-medium">
              {pick(globals, { ar: 'القسم', en: 'Department' })}
            </label>
            <select
              id="story-users-department"
              className={`${toolbarFieldClasses} select-chevron pe-10`}
            >
              <option>{pick(globals, { ar: 'كل الأقسام', en: 'All departments' })}</option>
            </select>
          </div>
          <div>
            <button type="button" className={buttonClasses({ variant: 'secondary' })}>
              <Icon name="search" />
              {pick(globals, { ar: 'تطبيق', en: 'Apply' })}
            </button>
          </div>
        </form>
        <Card flush>
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table}>
              <caption className="sr-only">
                {pick(globals, { ar: 'قائمة أعضاء الفريق', en: 'Team members list' })}
              </caption>
              <thead className={tableClasses.header}>
                <tr>
                  {(
                    [
                      { ar: 'الاسم', en: 'Name' },
                      { ar: 'الرقم الوظيفي', en: 'Employee number' },
                      { ar: 'الدور الأساسي', en: 'Primary role' },
                      { ar: 'القسم', en: 'Department' },
                      { ar: 'الحالة', en: 'Status' },
                      { ar: 'آخر دخول', en: 'Last sign-in' },
                    ] as const
                  ).map((column) => (
                    <th key={column.en} scope="col" className={tableClasses.head}>
                      {pick(globals, column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PEOPLE.map((person) => {
                  const name = pick(globals, person);
                  return (
                    <tr key={person.email} className={tableClasses.row}>
                      <td className={tableClasses.cell}>
                        <div className="flex items-center gap-3">
                          <Avatar name={name} tone="soft" size="md" />
                          <div className="min-w-0">
                            <a href="#member" className="font-medium">
                              {name}
                            </a>
                            <div className="text-sm text-text-muted">
                              <bdi dir="ltr">{person.email}</bdi>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={tableClasses.cell}>
                        <bdi dir="ltr">{person.number}</bdi>
                      </td>
                      <td className={tableClasses.cell}>{pick(globals, person.role)}</td>
                      <td className={tableClasses.cell}>{pick(globals, person.department)}</td>
                      <td className={tableClasses.cell}>
                        <Badge tone={STATUS[person.status].tone}>
                          {pick(globals, STATUS[person.status].label)}
                        </Badge>
                      </td>
                      <td className={tableClasses.cell}>{pick(globals, person.last)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DemoShell>
  ),
};

function Select({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        defaultValue={value}
        className="select-chevron min-h-9 w-full rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1 pointer-coarse:min-h-11"
      >
        <option>{value}</option>
      </select>
    </div>
  );
}

function Choice({ label, checked, lang }: { label: string; checked: boolean; lang?: string }) {
  return (
    <label
      lang={lang}
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 ${
        checked
          ? 'border-primary bg-primary-subtle font-medium text-primary-text'
          : 'border-border-strong bg-surface'
      }`}
    >
      <input
        type="radio"
        name={lang ? 'story-language' : 'story-display'}
        defaultChecked={checked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

/** Settings → General (`/suite/admin/settings`, Kawadir Branding): one card per section, tips aside. */
export const GeneralSettings: Story = {
  render: (_args, { globals }) => (
    <DemoShell
      globals={globals}
      current="general"
      title={{ ar: 'الإعدادات العامة', en: 'General' }}
    >
      <PageHeader
        eyebrow={
          <nav aria-label={pick(globals, { ar: 'مسار التنقل', en: 'Breadcrumb' })}>
            <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              <li>{pick(globals, { ar: 'الإعدادات', en: 'Settings' })}</li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">
                {pick(globals, { ar: 'الإعدادات العامة', en: 'General settings' })}
              </li>
            </ol>
          </nav>
        }
        title={pick(globals, { ar: 'الإعدادات العامة', en: 'General settings' })}
        description={pick(globals, {
          ar: 'كيف تظهر منشأتك في جدارات، والإعدادات الافتراضية التي يبدأ بها الجميع. يبقى بإمكان كل شخص تغيير لغته.',
          en: 'How your organization appears in Jadarat TMS, and the defaults everyone starts with. People can still change their own language.',
        })}
      />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_34rem] flex-col gap-6">
          <Card
            title={pick(globals, { ar: 'المنشأة', en: 'Organization' })}
            description={pick(globals, {
              ar: 'يظهر في القائمة الجانبية وفي رسائل البريد والشهادات.',
              en: 'Shown in the sidebar, on e-mails and on certificates.',
            })}
            icon="building"
            className="flex flex-col gap-5 *:first:mb-0"
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
              <TextField
                id="story-org-name-en"
                lang="en"
                dir="ltr"
                label={pick(globals, {
                  ar: 'الاسم المعروض (بالإنجليزية)',
                  en: 'Display name (English)',
                })}
                defaultValue="Al Raya Company"
              />
              <TextField
                id="story-org-name-ar"
                lang="ar"
                dir="rtl"
                label={pick(globals, {
                  ar: 'الاسم المعروض (بالعربية)',
                  en: 'Display name (Arabic)',
                })}
                defaultValue="شركة الراية"
              />
              <Select
                id="story-org-industry"
                label={pick(globals, { ar: 'القطاع', en: 'Industry' })}
                value={pick(globals, { ar: 'التعليم', en: 'Education' })}
              />
              <Select
                id="story-org-country"
                label={pick(globals, { ar: 'الدولة', en: 'Country' })}
                value={pick(globals, { ar: 'المملكة العربية السعودية', en: 'Saudi Arabia' })}
              />
            </div>
          </Card>
          <Card
            title={pick(globals, { ar: 'الإعدادات الافتراضية', en: 'Defaults' })}
            description={pick(globals, {
              ar: 'تُستخدم للمستخدمين الجدد والتواريخ والمبالغ والتقارير.',
              en: 'Used for new users, dates, amounts and reports.',
            })}
            icon="globe"
            className="flex flex-col gap-5 *:first:mb-0"
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
              <Select
                id="story-org-currency"
                label={pick(globals, { ar: 'العملة', en: 'Currency' })}
                value={pick(globals, { ar: 'ريال سعودي (SAR)', en: 'Saudi riyal (SAR)' })}
              />
              <Select
                id="story-org-zone"
                label={pick(globals, { ar: 'المنطقة الزمنية', en: 'Timezone' })}
                value={pick(globals, { ar: 'الرياض (GMT+3)', en: 'Riyadh (GMT+3)' })}
              />
              <Select
                id="story-org-fiscal"
                label={pick(globals, { ar: 'بداية السنة المالية', en: 'Fiscal year starts in' })}
                value={pick(globals, { ar: 'يناير', en: 'January' })}
              />
            </div>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-sm font-medium">
                {pick(globals, { ar: 'اللغة الافتراضية', en: 'Default language' })}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Choice label="English" lang="en" checked />
                <Choice label="العربية" lang="ar" checked={false} />
              </div>
            </fieldset>
          </Card>
        </div>
        <aside
          aria-label={pick(globals, { ar: 'تلميحات', en: 'Tips' })}
          className="flex min-w-0 flex-[1_1_16rem] flex-col gap-4 lg:max-w-80"
        >
          <div className="flex gap-3 rounded-xl border border-info/30 bg-info-subtle p-4 text-sm">
            <Icon name="info" className="mt-0.5 shrink-0 text-info" />
            <div>
              <p className="m-0 mb-1 font-semibold text-text">
                {pick(globals, { ar: 'الدولة تملأ الباقي', en: 'Country fills in the rest' })}
              </p>
              <p className="m-0 text-text-muted">
                {pick(globals, {
                  ar: 'عند اختيار الدولة نقترح عملتها ومنطقتها الزمنية وأسبوع العمل وطريقة عرض التاريخ. راجعها ثم احفظ.',
                  en: 'When you pick a country we suggest its currency, timezone, working week and date display. Check them, then save.',
                })}
              </p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-1">
            <Icon name="info" className="mt-0.5 shrink-0 text-text-muted" />
            <div>
              <p className="m-0 mb-1 font-semibold text-text">
                {pick(globals, { ar: 'بيانات لا نطلبها', en: 'Not collected' })}
              </p>
              <p className="m-0 text-text-muted">
                {pick(globals, {
                  ar: 'لا نطلب بيانات قانونية أو تسجيلية مثل السجل التجاري أو الرقم الضريبي.',
                  en: "We don't ask for legal or registration details such as commercial registration or VAT number.",
                })}
              </p>
            </div>
          </div>
        </aside>
      </div>
      <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-2 sm:px-5">
        <span className="flex-[1_1_16rem] text-sm text-text-muted">
          {pick(globals, {
            ar: 'لم تُعدَّل منذ إعداد منشأتك.',
            en: 'Not changed since your organization was set up.',
          })}
        </span>
        <button type="button" className={buttonClasses({ variant: 'secondary' })}>
          {pick(globals, { ar: 'إلغاء', en: 'Cancel' })}
        </button>
        <button type="button" className={buttonClasses({ variant: 'primary' })}>
          {pick(globals, { ar: 'حفظ التغييرات', en: 'Save changes' })}
        </button>
      </div>
    </DemoShell>
  ),
};
