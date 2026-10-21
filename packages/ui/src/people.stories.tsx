import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { DemoShell } from '../.storybook/demo-shell';
import { type Copy, pick } from '../.storybook/l10n';
import { Alert } from './alert';
import { AttentionItem, AttentionStrip } from './attention-strip';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Card } from './card';
import { ChoiceCard } from './choice-card';
import { CopyButton } from './copy-button';
import { FilterBar, FilterMenu, ListCard, ListCards, ListSearch, Pagination } from './index';
import { Icon } from './icons';
import { PageHeader } from './page-header';
import { SaveBar } from './save-bar';
import { SidePanel } from './side-panel';
import { TabNav } from './tab-nav';
import { tableClasses } from './table';
import { ViewCards } from './view-cards';

/**
 * People & roles in direction C (redesign package 3, approved by the PO on 21 Oct 2026): Team members
 * with the attention strip, instant filter pills and the row menu; the quick look and the change-role
 * panel; a person's profile with its tabs; the roles list and a role's permissions in words; the import's
 * confirmation with its options. The markup follows apps/suite (components/users, components/roles,
 * components/user-import); sample names and figures only. Tagged `brand-matrix`: also with organization
 * colours (FR-ADM-07).
 */
const meta = {
  title: 'Pages/People & roles',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen', frame: 'bare' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
type Globals = Record<string, unknown>;

interface Person {
  readonly name: Copy;
  readonly email: string;
  readonly number: string | null;
  readonly role: Copy;
  readonly unit: Copy;
  readonly status: 'active' | 'invited';
  readonly lastSignIn: Copy;
}

const PEOPLE: readonly Person[] = [
  {
    name: { ar: 'سارة الحربي', en: 'Sara Al-Harbi' },
    email: 'sara.alharbi@demo-org.example',
    number: 'EMP-1450',
    role: { ar: 'مدير التعلم والتطوير', en: 'L&D Manager' },
    unit: { ar: 'تطوير المواهب', en: 'Talent Development' },
    status: 'active',
    lastSignIn: { ar: '21 أكتوبر 2026، 09:12', en: '21 Oct 2026, 09:12' },
  },
  {
    name: { ar: 'منى القحطاني', en: 'Mona Al-Qahtani' },
    email: 'mona.alqahtani@demo-org.example',
    number: 'EMP-1187',
    role: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    unit: { ar: 'عمليات التدريب', en: 'Training Operations' },
    status: 'active',
    lastSignIn: { ar: '20 أكتوبر 2026، 16:05', en: '20 Oct 2026, 16:05' },
  },
  {
    name: { ar: 'عمر الشهري', en: 'Omar Al-Shehri' },
    email: 'omar.alshehri@demo-org.example',
    number: null,
    role: { ar: 'رئيس القسم', en: 'Department Head' },
    unit: { ar: 'التوظيف', en: 'Recruitment' },
    status: 'invited',
    lastSignIn: { ar: 'لم يسجّل الدخول', en: 'Never signed in' },
  },
];

const T = {
  team: { ar: 'أعضاء الفريق', en: 'Team members' },
  attention: { ar: 'يحتاج إلى انتباهك', en: 'Needs your attention' },
  more: { ar: 'إجراءات أخرى لـ', en: 'More actions for ' },
  close: { ar: 'إغلاق', en: 'Close' },
  notSet: { ar: 'غير محدد', en: 'Not set' },
  changeRole: { ar: 'تغيير الدور', en: 'Change role' },
  openProfile: { ar: 'فتح الملف الكامل', en: 'Open full profile' },
} as const satisfies Record<string, Copy>;

function TeamPage({ globals, children }: { globals: Globals; children?: ReactNode }) {
  const name = (p: Person) => pick(globals, p.name);
  return (
    <DemoShell globals={globals} current="team">
      <PageHeader
        title={pick(globals, T.team)}
        description={pick(globals, {
          ar: 'أعضاء منشأتك وأدوارهم والدعوات التي لم تُقبل بعد.',
          en: 'The people of your organization, their roles and the invitations not accepted yet.',
        })}
        actions={
          <>
            <a href="#import" className={buttonClasses({ variant: 'secondary' })}>
              <Icon name="upload" className="size-4" />
              {pick(globals, { ar: 'استيراد من ملف', en: 'Import from file' })}
            </a>
            <a href="#invite" className={buttonClasses({ variant: 'primary' })}>
              <Icon name="user-plus" />
              {pick(globals, { ar: 'دعوة مستخدم', en: 'Invite user' })}
            </a>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <AttentionStrip title={pick(globals, T.attention)}>
          <AttentionItem
            icon="sync"
            tone="info"
            action={
              <a href="#progress" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {pick(globals, { ar: 'عرض التقدم', en: 'View progress' })}
              </a>
            }
          >
            {pick(globals, {
              ar: 'جارٍ استيراد المستخدمين من staff-october.xlsx: أُضيف 128 من 212 شخصًا حتى الآن.',
              en: 'Importing users from staff-october.xlsx: 128 of 212 people added so far.',
            })}
          </AttentionItem>
          <AttentionItem
            icon="clock"
            action={
              <Button variant="secondary" size="sm">
                {pick(globals, {
                  ar: 'إعادة إرسال الدعوات المنتهية (2)',
                  en: 'Resend expired invitations (2)',
                })}
              </Button>
            }
          >
            {pick(globals, {
              ar: 'انتهت صلاحية دعوتين قبل قبولهما. يمكنك إعادة إرسالهما الآن.',
              en: '2 invitations expired before they were accepted. You can resend them now.',
            })}
          </AttentionItem>
        </AttentionStrip>
        <ViewCards
          label={pick(globals, { ar: 'عرض أعضاء الفريق', en: 'Team members views' })}
          current="all"
          items={[
            {
              key: 'all',
              href: '#all',
              label: pick(globals, { ar: 'الكل', en: 'All' }),
              count: '42',
            },
            {
              key: 'active',
              href: '#active',
              label: pick(globals, { ar: 'نشط', en: 'Active' }),
              count: '35',
            },
            {
              key: 'invited',
              href: '#invited',
              label: pick(globals, { ar: 'الدعوات المعلّقة', en: 'Pending invites' }),
              count: '5',
            },
            {
              key: 'deactivated',
              href: '#deactivated',
              label: pick(globals, { ar: 'معطّل', en: 'Deactivated' }),
              count: '2',
            },
          ]}
        />
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <ListSearch
            id="story-users-q"
            label={pick(globals, { ar: 'بحث', en: 'Search' })}
            placeholder={pick(globals, {
              ar: 'بالاسم أو البريد أو الرقم الوظيفي',
              en: 'By name, email or employee number',
            })}
          />
          <FilterBar>
            <FilterMenu
              label={pick(globals, { ar: 'الدور', en: 'Role' })}
              value={null}
              options={[]}
              allLabel={pick(globals, { ar: 'كل الأدوار', en: 'All roles' })}
              onChange={() => undefined}
              removeLabel=""
            />
            <FilterMenu
              label={pick(globals, { ar: 'الوحدة', en: 'Unit' })}
              value="fin"
              options={[{ value: 'fin', label: pick(globals, { ar: 'المالية', en: 'Finance' }) }]}
              allLabel={pick(globals, { ar: 'كل الوحدات', en: 'All units' })}
              onChange={() => undefined}
              removeLabel={pick(globals, {
                ar: 'إزالة عامل التصفية الوحدة: المالية',
                en: 'Remove the filter Unit: Finance',
              })}
            />
          </FilterBar>
          <p role="status" className="m-0 text-sm text-text-muted md:ms-auto">
            {pick(globals, { ar: 'عرض 1–3 من 3', en: 'Showing 1–3 of 3' })}
          </p>
        </div>
        <Card flush>
          <div className="hidden md:block">
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table}>
                <caption className="sr-only">{pick(globals, T.team)}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    {[
                      { ar: 'الاسم', en: 'Name' },
                      { ar: 'الرقم الوظيفي', en: 'Employee number' },
                      { ar: 'الدور الأساسي', en: 'Primary role' },
                      { ar: 'الوحدة', en: 'Unit' },
                      { ar: 'الحالة', en: 'Status' },
                      { ar: 'آخر دخول', en: 'Last sign-in' },
                    ].map((h) => (
                      <th key={h.en} scope="col" className={tableClasses.head}>
                        {pick(globals, h)}
                      </th>
                    ))}
                    <th scope="col" className={tableClasses.head}>
                      <span className="sr-only">
                        {pick(globals, { ar: 'إجراءات', en: 'Actions' })}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PEOPLE.map((p) => (
                    <tr key={p.email} className={tableClasses.row}>
                      <td className={tableClasses.cell}>
                        <div className="flex items-center gap-3">
                          <Avatar name={name(p)} tone="soft" size="md" />
                          <div className="min-w-0">
                            <button type="button" className="text-start font-semibold">
                              {name(p)}
                            </button>
                            <div className="text-sm text-text-muted">
                              <bdi dir="ltr">{p.email}</bdi>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={tableClasses.cell}>
                        {p.number ? (
                          <bdi dir="ltr">{p.number}</bdi>
                        ) : (
                          <span className="italic text-text-muted">{pick(globals, T.notSet)}</span>
                        )}
                      </td>
                      <td className={tableClasses.cell}>{pick(globals, p.role)}</td>
                      <td className={tableClasses.cell}>{pick(globals, p.unit)}</td>
                      <td className={tableClasses.cell}>
                        <Badge tone={p.status === 'active' ? 'success' : 'warning'} dot>
                          {pick(
                            globals,
                            p.status === 'active'
                              ? { ar: 'نشط', en: 'Active' }
                              : { ar: 'مدعو', en: 'Invited' },
                          )}
                        </Badge>
                      </td>
                      <td className={tableClasses.cell}>{pick(globals, p.lastSignIn)}</td>
                      <td className={`${tableClasses.cell} text-end`}>
                        <button
                          type="button"
                          aria-label={`${pick(globals, T.more)}${name(p)}`}
                          className="grid size-9 place-items-center rounded-full text-text-muted"
                        >
                          <Icon name="more" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ListCards>
            {PEOPLE.map((p) => (
              <ListCard
                key={p.email}
                leading={<Avatar name={name(p)} tone="soft" size="md" />}
                title={name(p)}
                detail={`${pick(globals, p.role)} · ${pick(globals, p.unit)}`}
                status={
                  <Badge tone={p.status === 'active' ? 'success' : 'warning'} dot>
                    {pick(
                      globals,
                      p.status === 'active'
                        ? { ar: 'نشط', en: 'Active' }
                        : { ar: 'مدعو', en: 'Invited' },
                    )}
                  </Badge>
                }
              />
            ))}
          </ListCards>
          <Pagination
            label={pick(globals, { ar: 'صفحات قائمة المستخدمين', en: 'Users list pages' })}
            range={pick(globals, { ar: 'عرض 1–3 من 3', en: 'Showing 1–3 of 3' })}
            previous={{ href: null, label: pick(globals, { ar: 'السابق', en: 'Previous' }) }}
            next={{ href: null, label: pick(globals, { ar: 'التالي', en: 'Next' }) }}
          />
        </Card>
      </div>
      {children}
    </DemoShell>
  );
}

/** Team members: the attention strip, view cards, instant filter pills, table (cards on phones). */
export const TeamMembers: Story = {
  render: (_args, { globals }) => <TeamPage globals={globals} />,
};

/** The quick look at a person (Plain's peek): copyable facts, Open full profile, Change role. */
export const QuickLook: Story = {
  render: (_args, { globals }) => {
    const p = PEOPLE[1] ?? PEOPLE[0];
    if (!p) return <></>;
    const facts: { label: Copy; value: ReactNode }[] = [
      {
        label: { ar: 'البريد الإلكتروني', en: 'Email' },
        value: (
          <span className="flex items-center justify-between gap-2">
            <bdi dir="ltr" className="[overflow-wrap:anywhere]">
              {p.email}
            </bdi>
            <CopyButton
              value={p.email}
              label={pick(globals, { ar: 'نسخ البريد الإلكتروني', en: 'Copy Email' })}
              copiedText=""
              failedText=""
            />
          </span>
        ),
      },
      { label: { ar: 'الدور الأساسي', en: 'Primary role' }, value: pick(globals, p.role) },
      { label: { ar: 'الوحدة', en: 'Unit' }, value: pick(globals, p.unit) },
      { label: { ar: 'آخر دخول', en: 'Last sign-in' }, value: pick(globals, p.lastSignIn) },
    ];
    return (
      <TeamPage globals={globals}>
        <SidePanel
          open
          onClose={() => undefined}
          title={pick(globals, p.name)}
          description={`${pick(globals, p.role)} · ${pick(globals, p.unit)}`}
          closeLabel={pick(globals, T.close)}
          footer={
            <>
              <a href="#profile" className={buttonClasses({ variant: 'primary' })}>
                {pick(globals, T.openProfile)}
                <Icon name="arrow-end" />
              </a>
              <Button variant="secondary">
                <Icon name="key" />
                {pick(globals, T.changeRole)}
              </Button>
            </>
          }
        >
          <dl className="m-0 flex flex-col">
            {facts.map((fact) => (
              <div
                key={fact.label.en}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 border-b border-border py-3"
              >
                <dt className="text-sm text-text-muted">{pick(globals, fact.label)}</dt>
                <dd className="m-0 font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </SidePanel>
      </TeamPage>
    );
  },
};

const ROLES: readonly { code: string; name: Copy; description: Copy; privileged?: boolean }[] = [
  {
    code: 'hr_manager',
    name: { ar: 'مدير الموارد البشرية', en: 'HR Manager' },
    description: {
      ar: 'سجلات الموظفين والفروع والهيكل؛ يدعو الأشخاص.',
      en: 'Employee records, branches and the structure; invites people.',
    },
    privileged: true,
  },
  {
    code: 'training_coordinator',
    name: { ar: 'منسق التدريب', en: 'Training Coordinator' },
    description: {
      ar: 'الجدولة والتسجيل والحضور.',
      en: 'Scheduling, enrollments and attendance.',
    },
  },
  {
    code: 'finance',
    name: { ar: 'معتمد مالي', en: 'Finance approver' },
    description: {
      ar: 'يعتمد التكلفة والميزانية في خطوة المالية.',
      en: 'Approves cost and budget at the finance step.',
    },
  },
];

function RolePanel({ globals }: { globals: Globals }) {
  const [role, setRole] = useState('finance');
  return (
    <SidePanel
      open
      onClose={() => undefined}
      title={pick(globals, {
        ar: 'تغيير دور منى القحطاني',
        en: 'Change the role of Mona Al-Qahtani',
      })}
      description={pick(globals, {
        ar: 'اختر دور منى القحطاني. لكل شخص دور واحد.',
        en: 'Choose the role of Mona Al-Qahtani. Each person has one role.',
      })}
      closeLabel={pick(globals, T.close)}
      footer={
        <>
          <p className="m-0 basis-full text-sm text-text-muted">
            {pick(globals, {
              ar: 'يُسجَّل كل تغيير للدور في سجل التدقيق.',
              en: 'Every role change is recorded in the audit log.',
            })}
          </p>
          <div className="ms-auto flex gap-2.5">
            <Button variant="secondary">{pick(globals, { ar: 'إلغاء', en: 'Cancel' })}</Button>
            <Button>{pick(globals, { ar: 'حفظ الدور', en: 'Save role' })}</Button>
          </div>
        </>
      }
    >
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="sr-only">{pick(globals, { ar: 'الدور', en: 'Role' })}</legend>
        {ROLES.map((r) => (
          <ChoiceCard
            key={r.code}
            id={`story-role-${r.code}`}
            name="story-role"
            value={r.code}
            checked={role === r.code}
            onChange={setRole}
            title={pick(globals, r.name)}
            description={pick(globals, r.description)}
            disabled={r.privileged}
            note={pick(globals, { ar: 'غير متاح لك', en: 'not available to you' })}
            badges={
              <>
                {r.privileged ? (
                  <Badge tone="warning">{pick(globals, { ar: 'مميز', en: 'privileged' })}</Badge>
                ) : null}
                {r.code === 'training_coordinator' ? (
                  <Badge tone="brand">
                    {pick(globals, { ar: 'الدور الحالي', en: 'Current role' })}
                  </Badge>
                ) : null}
              </>
            }
          >
            {r.code === 'finance' ? (
              <p className="m-0 text-sm text-text-muted">
                {pick(globals, {
                  ar: 'اختر وحدة واحدة بأي مستوى.',
                  en: 'Pick one unit, at any level.',
                })}
              </p>
            ) : null}
          </ChoiceCard>
        ))}
      </fieldset>
    </SidePanel>
  );
}

/** Change role in one side panel: role cards, the current one marked, privileged ones unavailable. */
export const ChangeRole: Story = {
  render: (_args, { globals }) => (
    <TeamPage globals={globals}>
      <RolePanel globals={globals} />
    </TeamPage>
  ),
};

/** A person's profile: large avatar, Edit details and Actions ▾, the tabs, the cards. */
export const PersonProfile: Story = {
  render: (_args, { globals }) => {
    const p = PEOPLE[1] ?? PEOPLE[0];
    if (!p) return <></>;
    return (
      <DemoShell globals={globals} current="team">
        <PageHeader
          breadcrumbs={[
            { label: pick(globals, T.team), href: '#team' },
            { label: pick(globals, p.name) },
          ]}
          breadcrumbsLabel={pick(globals, { ar: 'مسار التنقل', en: 'Breadcrumb' })}
          leading={<Avatar name={pick(globals, p.name)} size="xl" />}
          title={pick(globals, p.name)}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <span>{`${pick(globals, p.role)} · ${pick(globals, p.unit)}`}</span>
              <Badge tone="success" dot>
                {pick(globals, { ar: 'نشط', en: 'Active' })}
              </Badge>
            </span>
          }
          actions={
            <>
              <a href="#edit" className={buttonClasses({ variant: 'secondary' })}>
                <Icon name="pencil" className="size-4" />
                {pick(globals, { ar: 'تعديل البيانات', en: 'Edit details' })}
              </a>
              <Button variant="secondary">
                {pick(globals, { ar: 'إجراءات', en: 'Actions' })}
                <Icon name="chevron-down" className="size-4" />
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-5">
          <TabNav
            variant="underline"
            label={pick(globals, { ar: 'أقسام الملف', en: 'Profile sections' })}
            current="overview"
            items={[
              {
                key: 'overview',
                href: '#o',
                icon: 'user',
                label: pick(globals, { ar: 'نظرة عامة', en: 'Overview' }),
              },
              {
                key: 'security',
                href: '#s',
                icon: 'shield',
                label: pick(globals, { ar: 'الدخول والأمان', en: 'Sign-in and security' }),
              },
              {
                key: 'activity',
                href: '#a',
                icon: 'audit',
                label: pick(globals, { ar: 'النشاط الأخير', en: 'Recent activity' }),
              },
            ]}
          />
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card title={pick(globals, { ar: 'البيانات الأساسية', en: 'Basic information' })}>
              <dl className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  [{ ar: 'البريد الإلكتروني', en: 'Email' }, p.email],
                  [{ ar: 'الرقم الوظيفي', en: 'Employee number' }, p.number ?? ''],
                ].map(([label, value]) => (
                  <div key={(label as Copy).en} className="flex flex-col gap-1">
                    <dt className="text-sm text-text-muted">{pick(globals, label as Copy)}</dt>
                    <dd className="m-0 font-semibold">
                      <bdi dir="ltr">{value as string}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card title={pick(globals, { ar: 'الدور', en: 'Role' })}>
              <p className="m-0 flex items-center gap-3 rounded-lg border border-border bg-surface-sunken px-3.5 py-3 font-semibold">
                <span className="grid size-10 place-items-center rounded-md bg-brand-gradient text-on-brand">
                  <Icon name="key" />
                </span>
                {pick(globals, p.role)}
              </p>
            </Card>
          </div>
        </div>
      </DemoShell>
    );
  },
};

/** Roles & permissions: the Standard and Custom groups as rows with their counts and actions. */
export const RolesList: Story = {
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="roles">
      <PageHeader
        title={pick(globals, { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' })}
        actions={
          <a href="#new" className={buttonClasses({ variant: 'primary' })}>
            <Icon name="plus" />
            {pick(globals, { ar: 'إنشاء دور', en: 'Create role' })}
          </a>
        }
      />
      <section aria-labelledby="story-standard">
        <h2 id="story-standard" className="m-0 mb-3 text-[22px] font-bold">
          {pick(globals, { ar: 'قياسي', en: 'Standard' })}
        </h2>
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-surface p-0">
          {ROLES.slice(0, 2).map((r) => (
            <li
              key={r.code}
              className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
            >
              <span className="grid size-11 place-items-center rounded-md bg-brand-gradient text-on-brand">
                <Icon name="lock" />
              </span>
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex items-center gap-2 font-semibold">
                  {pick(globals, r.name)}
                  {r.privileged ? (
                    <Badge tone="info">{pick(globals, { ar: 'مميز', en: 'Privileged' })}</Badge>
                  ) : null}
                </div>
                <p className="m-0 text-sm text-text-muted">{pick(globals, r.description)}</p>
              </div>
              <Badge>{pick(globals, { ar: '9 صلاحيات', en: '9 permissions' })}</Badge>
              <a href="#view" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {pick(globals, { ar: 'عرض', en: 'View' })}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </DemoShell>
  ),
};

/** A role's permissions in words: Allowed / Not allowed, with a search. */
export const RolePermissions: Story = {
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="roles">
      <PageHeader title={pick(globals, { ar: 'مدير الموارد البشرية', en: 'HR Manager' })} />
      <div className="flex flex-col gap-3.5">
        <ListSearch
          id="story-permission-search"
          label={pick(globals, { ar: 'ابحث في الصلاحيات', en: 'Search permissions' })}
        />
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <h3 className="m-0 border-b border-border bg-surface-sunken px-4 py-3 text-base font-semibold">
            {pick(globals, { ar: 'الأشخاص', en: 'People' })}
          </h3>
          <ul className="m-0 list-none p-0">
            {[
              [{ ar: 'عرض المستخدمين', en: 'View users' }, true],
              [{ ar: 'إعادة ضبط تطبيقات المصادقة', en: 'Reset authenticator apps' }, false],
            ].map(([label, allowed]) => (
              <li
                key={(label as Copy).en}
                className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <Icon name={allowed ? 'check' : 'close'} className="mt-1 size-4" />
                <span className="flex flex-col">
                  <span className="font-semibold">{pick(globals, label as Copy)}</span>
                  <span className="text-[13px] text-text-muted">
                    {pick(
                      globals,
                      allowed
                        ? { ar: 'مسموح', en: 'Allowed' }
                        : { ar: 'غير مسموح', en: 'Not allowed' },
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DemoShell>
  ),
};

/** The role builder's save bar with unsaved changes and the scope notice with Undo. */
export const RoleBuilderUnsaved: Story = {
  render: (_args, { globals }) => (
    <DemoShell globals={globals} current="roles">
      <PageHeader title={pick(globals, { ar: 'إنشاء دور', en: 'Create role' })} />
      <form id="story-role-builder" className="flex flex-col gap-4">
        <Alert
          tone="warning"
          action={
            <Button variant="secondary" size="sm">
              <Icon name="undo" className="size-4" />
              {pick(globals, { ar: 'تراجع', en: 'Undo' })}
            </Button>
          }
        >
          {pick(globals, {
            ar: 'أُزيلت الصلاحيات الإدارية: تحتاج إلى المنشأة كلها.',
            en: 'Administrative permissions were cleared: they need the whole organization.',
          })}
        </Alert>
      </form>
      <SaveBar
        state="unsaved"
        form="story-role-builder"
        texts={{
          unsaved: pick(globals, { ar: 'لديك تغييرات لم تُحفظ.', en: 'You have unsaved changes.' }),
          saving: '',
          saved: '',
          save: pick(globals, { ar: 'حفظ الدور', en: 'Save role' }),
          cancel: pick(globals, { ar: 'إلغاء', en: 'Cancel' }),
        }}
      />
    </DemoShell>
  ),
};

/** The import's confirmation: the invitations choice next to the count it changes. */
export const ImportConfirmation: Story = {
  render: (_args, { globals }) => {
    function Options() {
      const [value, setValue] = useState('send');
      return (
        <Card title={pick(globals, { ar: 'الدعوات', en: 'Invitations' })}>
          <div className="flex flex-col gap-2.5">
            {[
              [
                'send',
                {
                  ar: 'إرسال الدعوات فور انتهاء الاستيراد',
                  en: 'Send the invitations as soon as the import ends',
                },
              ],
              [
                'hold',
                {
                  ar: 'إضافة الأشخاص دون إرسال الدعوات الآن',
                  en: 'Add the people without sending invitations now',
                },
              ],
            ].map(([key, label]) => (
              <ChoiceCard
                key={key as string}
                id={`story-invitations-${key as string}`}
                name="story-invitations"
                value={key as string}
                checked={value === key}
                onChange={setValue}
                title={pick(globals, label as Copy)}
              />
            ))}
          </div>
        </Card>
      );
    }
    return (
      <div className="min-h-dvh bg-bg p-6" dir={globals.locale === 'en' ? 'ltr' : 'rtl'}>
        <h1 className="m-0 mb-5 text-[28px] font-bold">
          {pick(globals, { ar: 'تأكيد الاستيراد', en: 'Confirm the import' })}
        </h1>
        <Options />
      </div>
    );
  },
};
