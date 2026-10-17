import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PEOPLE, PreviewShell, localeOf } from '../../.storybook/theme-preview-kit';
import { Alert } from '../alert';
import { Badge } from '../badge';
import { Button, buttonClasses } from '../button';
import { Card } from '../card';
import { ChecklistAccordion, type ChecklistGroup } from '../checklist-accordion';
import { Dialog } from '../dialog';
import { Icon } from '../icons';
import { PageHeader } from '../page-header';
import { tableClasses } from '../table';
import { TextField } from '../text-field';

/**
 * Theme preview (EP-ROLES, FR-IAM-07/08; Kawadir's roles screen): the roles table, the role builder with
 * its permissions accordion, a standard role (view only) and the team list's «Edit role» dialog, as
 * built in apps/suite/src/app/[locale]/suite/admin/roles/ and components/roles, components/users
 * (member-role-menu, edit-role-form, role-select). Sample data.
 */
const meta = {
  title: 'Theme preview/Roles',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

type Locale = 'ar' | 'en';
type L = Readonly<Record<Locale, string>>;
const tx = (locale: Locale, text: L) => text[locale];

interface SampleRole {
  readonly code: string;
  readonly kind: 'standard' | 'custom';
  readonly name: L;
  readonly description: L | null;
  readonly privileged: boolean;
  readonly permissions: number;
  readonly people: number;
}

const ROLES: readonly SampleRole[] = [
  {
    code: 'tenant_admin',
    kind: 'standard',
    name: { ar: 'مدير المنظمة', en: 'Organization Admin' },
    description: {
      ar: 'يُعدّ المنظمة: الإعدادات والهوية والمستخدمون والأدوار والأمان والتكاملات وسجل التدقيق، دون الوصول إلى ميزات التدريب.',
      en: 'Sets up the organization: settings, branding, users and roles, security, integrations and audit. No access to training features.',
    },
    privileged: true,
    permissions: 15,
    people: 1,
  },
  {
    code: 'hr_manager',
    kind: 'standard',
    name: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    description: {
      ar: 'سجلات الموظفين والفروع والأقسام ورؤساؤها وقواعد الامتثال، ودعوة المستخدمين وإسناد الأدوار غير المميزة.',
      en: 'Employee records, branches, departments and department heads, compliance rules; invites people and gives roles that are not privileged.',
    },
    privileged: true,
    permissions: 8,
    people: 2,
  },
  {
    code: 'training_manager',
    kind: 'standard',
    name: { ar: 'مدير التعلم والتطوير', en: 'L&D Manager' },
    description: {
      ar: 'دليل الدورات ودورات التخطيط والخطة والميزانية والموافقات والجلسات والإشعارات وتقارير التدريب.',
      en: 'Course library, planning cycles, plan and budget, approvals, sessions, notifications and training reports.',
    },
    privileged: false,
    permissions: 3,
    people: 3,
  },
  {
    code: 'training_coordinator',
    kind: 'standard',
    name: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    description: {
      ar: 'الجدولة والتجهيزات والتسجيلات والحضور، والمساعدة في جمع الاحتياجات وتوحيدها.',
      en: 'Scheduling, logistics, enrollments and attendance; helps collect and consolidate needs.',
    },
    privileged: false,
    permissions: 3,
    people: 5,
  },
  {
    code: 'department_head',
    kind: 'standard',
    name: { ar: 'رئيس القسم', en: 'Department Head' },
    description: {
      ar: 'أقسامه فقط: يقترح الاحتياجات ويعتمد بنود الخطة والطلبات ويرى فريقه.',
      en: 'Their departments only: proposes needs, approves plan lines and requests, sees the team.',
    },
    privileged: false,
    permissions: 3,
    people: 9,
  },
  {
    code: 'learner',
    kind: 'standard',
    name: { ar: 'موظف', en: 'Employee' },
    description: {
      ar: 'طلباته وتدريبه وشهاداته.',
      en: 'Own requests, training and certificates.',
    },
    privileged: false,
    permissions: 1,
    people: 96,
  },
  {
    code: 'custom_5eed00000001',
    kind: 'custom',
    name: { ar: 'مدير مباشر', en: 'Line Manager' },
    description: {
      ar: 'طلبات فريقه المباشر وترشيحاته والموافقة عليها.',
      en: 'Direct reports’ requests, nominations and approvals.',
    },
    privileged: false,
    permissions: 3,
    people: 14,
  },
  {
    code: 'custom_5eed00000002',
    kind: 'custom',
    name: { ar: 'مدقق', en: 'Auditor' },
    description: null,
    privileged: true,
    permissions: 5,
    people: 0,
  },
];

const T = {
  title: { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' },
  intro: {
    ar: 'تأتي مع جدارات ستة أدوار قياسية لا تُعدَّل. ينشئ مدير المنظمة أدوار المنظمة الخاصة بتسميتها واختيار صلاحياتها.',
    en: 'Six standard roles come with Jadarat and can’t be changed. The Organization Admin creates the organization’s own roles by naming them and ticking permissions.',
  },
  createRole: { ar: 'إنشاء دور', en: 'Create role' },
  cardTitle: { ar: 'أدوار المنظمة', en: 'Roles of the organization' },
  cardDescription: {
    ar: 'يُسند لكل شخص دور واحد عند دعوته أو من صفحة أعضاء الفريق.',
    en: 'Give each person one role when you invite them or from Team members.',
  },
  columns: {
    role: { ar: 'الدور', en: 'Role' },
    description: { ar: 'الوصف', en: 'Description' },
    type: { ar: 'النوع', en: 'Type' },
    permissions: { ar: 'الصلاحيات', en: 'Permissions' },
    people: { ar: 'الأشخاص', en: 'People' },
    actions: { ar: 'الإجراءات', en: 'Actions' },
  },
  standard: { ar: 'قياسي', en: 'Standard' },
  custom: { ar: 'مخصص', en: 'Custom' },
  privileged: { ar: 'مميز', en: 'Privileged' },
  noDescription: { ar: 'بلا وصف', en: 'No description' },
  view: { ar: 'عرض', en: 'View' },
  edit: { ar: 'تعديل', en: 'Edit' },
  delete: { ar: 'حذف', en: 'Delete' },
  highRisk: { ar: 'عالي الخطورة', en: 'High risk' },
  countLabel: { ar: '{checked} من {total} محددة', en: '{checked} of {total} selected' },
} as const;

function permissionCount(locale: Locale, n: number) {
  if (locale === 'en') return `${n} ${n === 1 ? 'permission' : 'permissions'}`;
  if (n === 1) return 'صلاحية واحدة';
  if (n === 2) return 'صلاحيتان';
  return n <= 10 ? `${n} صلاحيات` : `${n} صلاحية`;
}

function peopleCount(locale: Locale, n: number) {
  if (locale === 'en') return `${n} ${n === 1 ? 'person' : 'people'}`;
  if (n === 0) return 'لا أحد';
  if (n === 1) return 'شخص واحد';
  return n <= 10 ? `${n} أشخاص` : `${n} شخصًا`;
}

function RolesListPage({ locale }: { locale: Locale }) {
  return (
    <PreviewShell locale={locale} current="roles">
      <PageHeader
        title={tx(locale, T.title)}
        description={tx(locale, T.intro)}
        actions={
          <a href="#new" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            <Icon name="plus" />
            {tx(locale, T.createRole)}
          </a>
        }
      />
      <Card flush title={tx(locale, T.cardTitle)} description={tx(locale, T.cardDescription)}>
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table}>
            <caption className="sr-only">{tx(locale, T.cardTitle)}</caption>
            <thead className={tableClasses.header}>
              <tr>
                {(['role', 'description', 'type', 'permissions', 'people'] as const).map((key) => (
                  <th key={key} scope="col" className={tableClasses.head}>
                    {tx(locale, T.columns[key])}
                  </th>
                ))}
                <th scope="col" className={`${tableClasses.head} text-end`}>
                  {tx(locale, T.columns.actions)}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => {
                const name = tx(locale, role.name);
                const custom = role.kind === 'custom';
                return (
                  <tr key={role.code} className={tableClasses.row}>
                    <td className={tableClasses.cell}>
                      <div className="flex items-center gap-2">
                        <Icon
                          name={custom ? 'shield-outline' : 'shield'}
                          className={custom ? 'text-text-muted' : 'text-primary'}
                        />
                        <a href={`#${role.code}`} className="font-medium">
                          {name}
                        </a>
                        {role.privileged ? (
                          <Badge tone="warning">{tx(locale, T.privileged)}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${tableClasses.cell} max-w-xs`}>
                      <span className="line-clamp-2 text-text-muted">
                        {role.description
                          ? tx(locale, role.description)
                          : tx(locale, T.noDescription)}
                      </span>
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone={custom ? 'neutral' : 'info'}>
                        {tx(locale, custom ? T.custom : T.standard)}
                      </Badge>
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone="neutral">{permissionCount(locale, role.permissions)}</Badge>
                    </td>
                    <td className={tableClasses.cell}>
                      {role.people > 0 ? (
                        <a href={`#users-${role.code}`}>{peopleCount(locale, role.people)}</a>
                      ) : (
                        <span className="text-text-muted">{peopleCount(locale, 0)}</span>
                      )}
                    </td>
                    <td className={`${tableClasses.cell} text-end`}>
                      <div className="flex items-center justify-end gap-1">
                        <a
                          href={`#${role.code}`}
                          aria-label={`${tx(locale, custom ? T.edit : T.view)} ${name}`}
                          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
                        >
                          <Icon name={custom ? 'pencil' : 'lock'} />
                        </a>
                        {custom && role.people === 0 ? (
                          <button
                            type="button"
                            aria-label={`${tx(locale, T.delete)} ${name}`}
                            className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger"
                          >
                            <Icon name="trash" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PreviewShell>
  );
}

const PERMISSION_GROUPS: readonly {
  key: string;
  title: L;
  items: readonly { code: string; label: L; description: L; high?: boolean; adminOnly?: boolean }[];
}[] = [
  {
    key: 'people',
    title: { ar: 'الأشخاص', en: 'People' },
    items: [
      {
        code: 'user.read',
        label: { ar: 'عرض المستخدمين', en: 'View users' },
        description: {
          ar: 'عرض المستخدمين وملفاتهم ضمن النطاق',
          en: 'View users and their profiles within scope',
        },
      },
      {
        code: 'user.invite',
        label: { ar: 'دعوة المستخدمين', en: 'Invite users' },
        description: {
          ar: 'دعوة أشخاص إلى المنظمة وإدارة الدعوات',
          en: 'Invite people to the organization and manage invitations',
        },
        adminOnly: true,
      },
      {
        code: 'user.deactivate',
        label: { ar: 'تعطيل المستخدمين', en: 'Deactivate users' },
        description: {
          ar: 'تعطيل حسابات المستخدمين وإعادة تفعيلها',
          en: 'Deactivate and reactivate user accounts',
        },
        adminOnly: true,
      },
    ],
  },
  {
    key: 'roles',
    title: { ar: 'الأدوار', en: 'Roles' },
    items: [
      {
        code: 'role.read',
        label: { ar: 'عرض الأدوار', en: 'View roles' },
        description: { ar: 'عرض الأدوار وصلاحياتها', en: 'View roles and their permissions' },
      },
    ],
  },
  {
    key: 'organization',
    title: { ar: 'الهيكل التنظيمي', en: 'Organization structure' },
    items: [
      {
        code: 'org.read',
        label: { ar: 'عرض الهيكل التنظيمي', en: 'View the organization structure' },
        description: {
          ar: 'عرض الأقسام والفروع ومراكز التكلفة',
          en: 'View departments, branches and cost centres',
        },
      },
    ],
  },
  {
    key: 'audit',
    title: { ar: 'سجل التدقيق', en: 'Audit log' },
    items: [
      {
        code: 'audit.read',
        label: { ar: 'عرض سجل التدقيق', en: 'View the audit log' },
        description: { ar: 'عرض سجل التدقيق للمنظمة', en: 'View the organization’s audit log' },
        high: true,
        adminOnly: true,
      },
    ],
  },
];

const SCOPES = [
  [
    'own',
    { ar: 'سجلاته فقط', en: 'Own records only' },
    { ar: 'طلبات الشخص وتدريبه وسجله.', en: 'The person’s own requests, training and record.' },
  ],
  [
    'team',
    { ar: 'فريقه', en: 'Their team' },
    { ar: 'من يتبعونه مباشرة.', en: 'The people who report directly to them.' },
  ],
  [
    'departments',
    { ar: 'أقسامه', en: 'Their departments' },
    {
      ar: 'الأقسام التي يرأسها مع أقسامها الفرعية.',
      en: 'The departments they head, with sub-departments.',
    },
  ],
  [
    'organization',
    { ar: 'المنظمة كلها', en: 'Whole organization' },
    {
      ar: 'كل من في المنظمة. لازم للصلاحيات الإدارية.',
      en: 'Everyone in the organization. Needed for administrative permissions.',
    },
  ],
] as const;

function accordionGroups(
  locale: Locale,
  checked: ReadonlySet<string>,
  scope: string,
  readOnly: boolean,
): ChecklistGroup[] {
  return PERMISSION_GROUPS.map((group) => ({
    key: group.key,
    title: tx(locale, group.title),
    items: group.items.map((item) => {
      const on = checked.has(item.code);
      const blocked = !readOnly && !on && item.adminOnly === true && scope !== 'organization';
      return {
        value: item.code,
        label: tx(locale, item.label),
        description: tx(locale, item.description),
        badge: item.high ? <Badge tone="warning">{tx(locale, T.highRisk)}</Badge> : undefined,
        checked: on,
        disabled: blocked,
        note: blocked
          ? tx(locale, {
              ar: 'لدور يرى المنظمة كلها فقط.',
              en: 'Only for a role that sees the whole organization.',
            })
          : undefined,
      };
    }),
  }));
}

const B = {
  title: { ar: 'إنشاء دور', en: 'Create role' },
  intro: {
    ar: 'سمِّ الدور واختر صلاحياته والبيانات التي يراها. يحصل كل من يحمله على أي تغيير عند فتح صفحته التالية.',
    en: 'Name the role, tick its permissions and choose the data it sees. Everyone who holds it gets a change at their next page.',
  },
  details: { ar: 'بيانات الدور', en: 'Role details' },
  startFrom: { ar: 'البدء من', en: 'Start from' },
  startHint: {
    ar: 'يملأ الصلاحيات (والاسم والوصف للقوالب)، ويمكنك تغيير كل شيء قبل الحفظ.',
    en: 'Fills in the permissions (and, for a template, the name and description); you can change everything before saving.',
  },
  blank: { ar: 'دور فارغ', en: 'A blank role' },
  copyStandard: { ar: 'نسخ دور قياسي', en: 'Copy a standard role' },
  templates: { ar: 'القوالب', en: 'Templates' },
  nameEn: { ar: 'الاسم بالإنجليزية', en: 'Name in English' },
  nameAr: { ar: 'الاسم بالعربية', en: 'Name in Arabic' },
  nameHint: {
    ar: 'لا يتكرر في المنظمة، ولا يزيد على 80 حرفًا.',
    en: 'Unique in the organization, up to 80 characters.',
  },
  description: { ar: 'الوصف', en: 'Description' },
  required: { ar: '(مطلوب)', en: '(required)' },
  optional: { ar: '(اختياري)', en: '(optional)' },
  dataScope: { ar: 'البيانات التي يراها هذا الدور', en: 'Data this role sees' },
  permissions: { ar: 'الصلاحيات', en: 'Permissions' },
  permissionsHint: {
    ar: 'مجمّعة حسب الوحدة. لا يمكنك إعطاء صلاحية لا تملكها.',
    en: 'Grouped by module. You can only give permissions you hold yourself.',
  },
  privilegedNotice: {
    ar: 'هذا الدور مميز — فيه صلاحية عالية الخطورة أو صلاحية لإدارة المستخدمين أو الأدوار — فلا يسنده إلا مدير المنظمة.',
    en: 'This role is privileged — it has a high-risk permission or manages users or roles — so only the Organization Admin can give it.',
  },

  audited: {
    ar: 'يُسجَّل كل تغيير في سجل التدقيق مع القيم قبله وبعده.',
    en: 'Every change is recorded in the audit log with the values before and after.',
  },
  save: { ar: 'حفظ الدور', en: 'Save role' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
} as const;

const selectClass =
  'select-chevron min-h-9 w-full rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1';

function CreateRolePage({ locale }: { locale: Locale }) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    new Set(['user.read', 'role.read', 'org.read', 'audit.read']),
  );
  const [scope, setScope] = useState('organization');
  const privileged = PERMISSION_GROUPS.some((g) =>
    g.items.some((i) => i.high === true && checked.has(i.code)),
  );
  return (
    <PreviewShell locale={locale} current="roles">
      <nav
        aria-label={tx(locale, { ar: 'مسار التنقل', en: 'Breadcrumb' })}
        className="mb-2 text-sm"
      >
        <a href="#roles">{tx(locale, T.title)}</a>
      </nav>
      <h1 className="mb-2 mt-0 text-2xl font-bold">{tx(locale, B.title)}</h1>
      <p className="mb-6 mt-0 text-text-muted">{tx(locale, B.intro)}</p>
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Card title={tx(locale, B.details)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="preview-role-start" className="text-sm font-medium">
                {tx(locale, B.startFrom)}
              </label>
              <p id="preview-role-start-hint" className="m-0 text-sm text-text-muted">
                {tx(locale, B.startHint)}
              </p>
              <select
                id="preview-role-start"
                aria-describedby="preview-role-start-hint"
                defaultValue="template:compliance_officer"
                className={selectClass}
              >
                <option value="blank">{tx(locale, B.blank)}</option>
                <optgroup label={tx(locale, B.copyStandard)}>
                  {ROLES.filter((r) => r.kind === 'standard' && r.code !== 'tenant_admin').map(
                    (r) => (
                      <option key={r.code} value={`standard:${r.code}`}>
                        {tx(locale, r.name)}
                      </option>
                    ),
                  )}
                </optgroup>
                <optgroup label={tx(locale, B.templates)}>
                  <option value="template:instructor">
                    {tx(locale, { ar: 'مدرب', en: 'Instructor' })}
                  </option>
                  <option value="template:finance_approver">
                    {tx(locale, { ar: 'معتمد مالي', en: 'Finance approver' })}
                  </option>
                  <option value="template:line_manager">
                    {tx(locale, { ar: 'مدير مباشر', en: 'Line Manager' })}
                  </option>
                  <option value="template:compliance_officer">
                    {tx(locale, { ar: 'مسؤول الامتثال', en: 'Compliance Officer' })}
                  </option>
                  <option value="template:auditor">
                    {tx(locale, { ar: 'مدقق', en: 'Auditor' })}
                  </option>
                </optgroup>
              </select>
            </div>
            <TextField
              id="preview-role-name-en"
              label={tx(locale, B.nameEn)}
              marker={tx(locale, B.required)}
              hint={tx(locale, B.nameHint)}
              defaultValue="Compliance Officer"
              dir="ltr"
              lang="en"
            />
            <TextField
              id="preview-role-name-ar"
              label={tx(locale, B.nameAr)}
              marker={tx(locale, B.required)}
              hint={tx(locale, B.nameHint)}
              defaultValue="مسؤول الامتثال"
              dir="rtl"
              lang="ar"
            />
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="preview-role-description" className="text-sm font-medium">
                {tx(locale, B.description)}
                <span className="ms-1 font-normal text-text-muted">{tx(locale, B.optional)}</span>
              </label>
              <textarea
                id="preview-role-description"
                rows={3}
                defaultValue={tx(locale, {
                  ar: 'لوحات الامتثال والتقارير التنظيمية، وعرض سجل التدقيق.',
                  en: 'Compliance dashboards and regulatory reports; reads the audit log.',
                })}
                className="w-full rounded-2xl border border-border-strong bg-surface px-4 py-2 text-sm text-text shadow-1"
              />
            </div>
          </div>
        </Card>

        <Card title={tx(locale, B.dataScope)}>
          <fieldset className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2">
            <legend className="sr-only">{tx(locale, B.dataScope)}</legend>
            {SCOPES.map(([value, label, hint]) => (
              <div
                key={value}
                className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 ${
                  scope === value ? 'border-primary bg-primary-subtle' : 'border-border'
                }`}
              >
                <input
                  id={`preview-scope-${value}`}
                  type="radio"
                  name="preview-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => {
                    setScope(value);
                  }}
                  aria-describedby={`preview-scope-${value}-hint`}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <div className="flex flex-col gap-0.5">
                  <label htmlFor={`preview-scope-${value}`} className="text-sm font-medium">
                    {tx(locale, label)}
                  </label>
                  <p id={`preview-scope-${value}-hint`} className="m-0 text-sm text-text-muted">
                    {tx(locale, hint)}
                  </p>
                </div>
              </div>
            ))}
          </fieldset>
        </Card>

        <Card title={tx(locale, B.permissions)}>
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-text-muted">{tx(locale, B.permissionsHint)}</p>
            {privileged ? <Alert tone="warning">{tx(locale, B.privilegedNotice)}</Alert> : null}
            <ChecklistAccordion
              groups={accordionGroups(locale, checked, scope, false)}
              defaultOpen="all"
              onToggle={(value, on) => {
                setChecked((current) => {
                  const next = new Set(current);
                  if (on) next.add(value);
                  else next.delete(value);
                  return next;
                });
              }}
              countLabel={tx(locale, T.countLabel)}
              idPrefix="preview-role-permission"
            />
          </div>
        </Card>

        <p className="m-0 text-sm text-text-muted">{tx(locale, B.audited)}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a href="#roles" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            {tx(locale, B.cancel)}
          </a>
          <Button type="submit">{tx(locale, B.save)}</Button>
        </div>
      </form>
    </PreviewShell>
  );
}

function StandardRolePage({ locale }: { locale: Locale }) {
  return (
    <PreviewShell locale={locale} current="roles">
      <nav
        aria-label={tx(locale, { ar: 'مسار التنقل', en: 'Breadcrumb' })}
        className="mb-2 text-sm"
      >
        <a href="#roles">{tx(locale, T.title)}</a>
      </nav>
      <h1 className="mb-6 mt-0 text-2xl font-bold">
        {tx(locale, { ar: 'رئيس القسم', en: 'Department Head' })}
      </h1>
      <div className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{tx(locale, T.standard)}</Badge>
            </div>
            <p className="m-0">
              {tx(locale, {
                ar: 'يرى أقسامه وموظفيها ويوافق على طلباتهم.',
                en: 'Sees their departments and their people, and approves their requests.',
              })}
            </p>
            <Alert tone="info">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 basis-64">
                  {tx(locale, {
                    ar: 'دور قياسي · للعرض فقط. لتغيير صلاحياته أنشئ دورًا مخصصًا منه.',
                    en: 'Standard role · view only. To change its permissions, create a custom role from it.',
                  })}
                </span>
                <a href="#new" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
                  <Icon name="plus" />
                  {tx(locale, { ar: 'إنشاء دور منه', en: 'Create a role from it' })}
                </a>
              </div>
            </Alert>
          </div>
        </Card>
        <Card title={tx(locale, B.permissions)}>
          <ChecklistAccordion
            groups={accordionGroups(
              locale,
              new Set(['user.read', 'role.read', 'org.read']),
              'departments',
              true,
            )}
            readOnly
            countLabel={tx(locale, T.countLabel)}
            idPrefix="preview-view-permission"
          />
        </Card>
      </div>
    </PreviewShell>
  );
}

const D = {
  actionsFor: { ar: 'إجراءات', en: 'Actions for' },
  editRole: { ar: 'تعديل الدور', en: 'Edit role' },
  dialogDescription: {
    ar: 'اختر دور {name}. لكل شخص دور واحد.',
    en: 'Choose the role of {name}. Each person has one role.',
  },
  role: { ar: 'الدور', en: 'Role' },
  roleHint: {
    ar: 'لكل شخص دور واحد، يحدد قائمته وصفحاته والبيانات التي يراها.',
    en: 'Each person has one role. It decides their menu, pages and the data they see.',
  },
  standardGroup: { ar: 'الأدوار القياسية', en: 'Standard roles' },
  customGroup: { ar: 'الأدوار المخصصة', en: 'Custom roles' },
  privilegedSuffix: { ar: 'مميز', en: 'privileged' },
  notAllowed: { ar: 'غير متاح لك', en: 'not available to you' },
  departmentsHint: {
    ar: 'يرى هذا الدور الأقسام التي يرأسها الشخص مع أقسامها الفرعية. يحدد رؤساء الأقسام مدير الموارد البشرية من المنظمة ← الهيكل التنظيمي.',
    en: 'This role sees the departments the person heads, with their sub-departments. HR sets department heads in Organization → Structure.',
  },
  locked: {
    ar: 'الأدوار غير المتاحة معطّلة: يسند الأدوار المميزة مدير المنظمة فقط، ولا يسند أحد دورًا فيه صلاحيات لا يملكها.',
    en: 'Unavailable roles are greyed out: only the Organization Admin gives privileged roles, and nobody gives a role with permissions they don’t hold.',
  },
  audited: {
    ar: 'يُسجَّل كل تغيير للدور في سجل التدقيق مع الدور قبل التغيير وبعده.',
    en: 'Every role change is recorded in the audit log with the role before and after.',
  },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  save: { ar: 'حفظ الدور', en: 'Save role' },
  close: { ar: 'إغلاق', en: 'Close' },
  teamMembers: { ar: 'أعضاء الفريق', en: 'Team members' },
} as const;

/** The role dropdown as the HR Manager sees it (privileged roles listed but not available). */
function RoleSelectPreview({
  locale,
  id,
  value,
  onChange,
  asHr,
}: {
  locale: Locale;
  id: string;
  value: string;
  onChange: (code: string) => void;
  asHr: boolean;
}) {
  const option = (role: SampleRole | { code: string; name: L; privileged: boolean }) => {
    const unavailable = asHr && role.privileged;
    const suffix = [
      role.privileged ? tx(locale, D.privilegedSuffix) : null,
      unavailable ? tx(locale, D.notAllowed) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const name = tx(locale, role.name);
    return (
      <option key={role.code} value={role.code} disabled={unavailable}>
        {suffix ? `${name} (${suffix})` : name}
      </option>
    );
  };
  const standard = ROLES.filter((r) => r.kind === 'standard');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {tx(locale, D.role)}
      </label>
      <p id={`${id}-hint`} className="m-0 text-sm text-text-muted">
        {tx(locale, D.roleHint)}
      </p>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-describedby={`${id}-hint`}
        className={selectClass}
      >
        <optgroup label={tx(locale, D.standardGroup)}>{standard.map(option)}</optgroup>
        <optgroup label={tx(locale, D.customGroup)}>
          {ROLES.filter((r) => r.kind === 'custom').map(option)}
        </optgroup>
      </select>
    </div>
  );
}

function EditRoleDialogPage({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(true);
  const [role, setRole] = useState('department_head');
  const person = PEOPLE[1];
  const name = person ? tx(locale, person.name) : '';
  return (
    <PreviewShell locale={locale} current="users">
      <PageHeader title={tx(locale, D.teamMembers)} />
      <Card flush>
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table}>
            <caption className="sr-only">{tx(locale, D.teamMembers)}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {tx(locale, { ar: 'الاسم', en: 'Name' })}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {tx(locale, D.role)}
                </th>
                <th scope="col" className={tableClasses.head}>
                  <span className="sr-only">{tx(locale, T.columns.actions)}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className={tableClasses.row}>
                <td className={tableClasses.cell}>{name}</td>
                <td className={tableClasses.cell}>
                  {tx(locale, { ar: 'منسق التدريب', en: 'Training Coordinator' })}
                </td>
                <td className={`${tableClasses.cell} text-end`}>
                  <button
                    type="button"
                    aria-label={`${tx(locale, D.actionsFor)} ${name}`}
                    onClick={() => {
                      setOpen(true);
                    }}
                    className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
                  >
                    <Icon name="more" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={tx(locale, D.editRole)}
        description={tx(locale, D.dialogDescription).replace('{name}', name)}
        closeLabel={tx(locale, D.close)}
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <RoleSelectPreview
            locale={locale}
            id="preview-edit-role"
            value={role}
            onChange={setRole}
            asHr
          />
          {role === 'department_head' ? (
            <Alert tone="info">{tx(locale, D.departmentsHint)}</Alert>
          ) : null}
          <p className="m-0 text-sm text-text-muted">{tx(locale, D.locked)}</p>
          <p className="m-0 text-sm text-text-muted">{tx(locale, D.audited)}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {tx(locale, D.cancel)}
            </Button>
            <Button type="submit">{tx(locale, D.save)}</Button>
          </div>
        </form>
      </Dialog>
    </PreviewShell>
  );
}

export const RolesList: Story = {
  render: (_args, { globals }) => <RolesListPage locale={localeOf(globals)} />,
};

export const CreateRole: Story = {
  render: (_args, { globals }) => <CreateRolePage locale={localeOf(globals)} />,
};

export const StandardRole: Story = {
  render: (_args, { globals }) => <StandardRolePage locale={localeOf(globals)} />,
};

export const EditRoleDialog: Story = {
  render: (_args, { globals }) => <EditRoleDialogPage locale={localeOf(globals)} />,
};
