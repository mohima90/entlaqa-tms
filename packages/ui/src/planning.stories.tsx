import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoShell } from '../.storybook/demo-shell';
import { type Copy, pick } from '../.storybook/l10n';
import { Alert } from './alert';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Card } from './card';
import { EmptyState } from './empty-state';
import { Icon } from './icons';
import { FilterBar, FilterMenu, ListSearch, ViewCards } from './index';
import { PageHeader } from './page-header';
import { ProgressBar } from './progress-bar';
import { StepList, type StepListItem } from './step-list';
import { tableClasses } from './table';

/**
 * Planning & courses in direction C (redesign package 4, approved by the PO on 21 Oct 2026): the cycles
 * list grouped by status with the open cycle's progress card, the first-use empty state, the set-up's step
 * list with «Review & launch» and its problems, and the course library with view cards and instant
 * filters. The markup follows apps/suite (app/[locale]/suite/planning, components/planning,
 * components/courses); sample names and figures only. Tagged `brand-matrix`: also with organization
 * colours (FR-ADM-07).
 */
const meta = {
  title: 'Pages/Planning & courses',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen', frame: 'bare' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
type Globals = Record<string, unknown>;

const T = {
  cycles: { ar: 'حملات حصر الاحتياجات', en: 'Planning cycles' },
  intro: {
    ar: 'اسأل رؤساء الوحدات كل عام عن احتياجات فرقهم التدريبية، ثم حوّل الإجابات إلى خطة تدريب واحدة.',
    en: 'Each year ask every unit head what training their team needs, then turn the answers into one training plan.',
  },
  newCycle: { ar: 'حملة جديدة', en: 'New cycle' },
  open: { ar: 'مفتوحة', en: 'Open' },
  drafts: { ar: 'مسودات', en: 'Drafts' },
  plan: { ar: 'خطة التدريب 2027', en: 'Training plan 2027' },
  period: { ar: 'فترة التخطيط', en: 'Planning period' },
  deadline: { ar: 'الموعد النهائي', en: 'Deadline' },
  submitted: { ar: 'أُرسل 4 من 9', en: '4 of 9 submitted' },
  daysLeft: { ar: 'بقي 30 يومًا', en: '30 days left' },
  viewProgress: { ar: 'عرض التقدم', en: 'View progress' },
  continue: { ar: 'متابعة الإعداد', en: 'Continue set-up' },
} as const satisfies Record<string, Copy>;

function CyclesPage({ globals, empty = false }: { globals: Globals; empty?: boolean }) {
  const t = (copy: Copy) => pick(globals, copy);
  return (
    <DemoShell globals={globals} current="home">
      <PageHeader
        title={t(T.cycles)}
        description={t(T.intro)}
        actions={
          <a href="#new" className={buttonClasses({ variant: 'primary' })}>
            <Icon name="plus" />
            {t(T.newCycle)}
          </a>
        }
      />
      {empty ? (
        <section className="rounded-xl border border-border bg-surface shadow-2">
          <EmptyState
            icon="flag"
            title={t({ ar: 'لا توجد حملات حصر احتياجات بعد', en: 'No planning cycles yet' })}
            stepsTitle={t({ ar: 'كيف تعمل حملة حصر الاحتياجات', en: 'How a planning cycle works' })}
            steps={[
              {
                title: t({
                  ar: 'اضبط الفترة والوحدات وميزانياتها والمعتمدين.',
                  en: 'Set up the period, the units, their budgets and the approvers.',
                }),
              },
              {
                title: t({
                  ar: 'أطلق الحملة: يصل نموذج الاحتياجات إلى رئيس كل وحدة مع الموعد النهائي.',
                  en: 'Launch: every unit head gets a needs form with your deadline.',
                }),
              },
              {
                title: t({
                  ar: 'تابع الإجابات حتى الموعد النهائي، ثم وحّدها في خطة واحدة.',
                  en: 'Follow the answers until the deadline, then consolidate them into one plan.',
                }),
              },
            ]}
          />
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3.5" aria-labelledby="story-open">
            <h2 id="story-open" className="m-0 text-[22px] font-bold">
              {t(T.open)}
            </h2>
            <article className="grid grid-cols-1 gap-5 rounded-[26px] bg-stat-gradient px-7 py-7 text-on-brand xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-on-brand/15 px-2.5 py-0.5 text-[13px] font-semibold">
                  {t(T.open)}
                </span>
                <h3 className="m-0 mt-2.5 text-[30px] font-bold">{t(T.plan)}</h3>
                <dl className="m-0 mt-4 flex flex-wrap gap-x-5.5 gap-y-2.5 text-[14.5px]">
                  <div>
                    <dt className="text-[13px] opacity-90">{t(T.period)}</dt>
                    <dd className="m-0 font-semibold">Jan 1, 2027 – Dec 31, 2027</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] opacity-90">{t(T.deadline)}</dt>
                    <dd className="m-0 font-semibold">Nov 20, 2026</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-col gap-3 rounded-[20px] border border-on-brand/25 bg-on-brand/10 px-5.5 py-5">
                <div className="flex items-center justify-between">
                  <span className="text-[34px] font-bold">
                    4<small className="ms-1.5 text-[15px] font-medium">/ 9</small>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Icon name="clock" className="size-4" />
                    {t(T.daysLeft)}
                  </span>
                </div>
                <ProgressBar tone="on-brand" value={4} max={9} label={t(T.submitted)} />
                <span>{t(T.submitted)}</span>
                <a
                  href="#cycle"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-on-brand px-5 font-semibold text-brand no-underline"
                >
                  {t(T.viewProgress)}
                  <Icon name="arrow-end" className="size-4" />
                </a>
              </div>
            </article>
          </section>
          <section className="flex flex-col gap-3.5" aria-labelledby="story-drafts">
            <h2 id="story-drafts" className="m-0 text-[22px] font-bold">
              {t(T.drafts)}
            </h2>
            <article className="flex max-w-sm flex-col gap-3.5 rounded-[22px] border border-border bg-surface px-5.5 py-5">
              <div className="flex items-start gap-3">
                <h3 className="m-0 flex-1 text-[17px] font-bold">
                  {t({ ar: 'احتياجات فرع جدة 2027', en: 'Branch needs — Jeddah 2027' })}
                </h3>
                <Badge dot>{t({ ar: 'مسودة', en: 'Draft' })}</Badge>
              </div>
              <a href="#continue" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {t(T.continue)}
                <Icon name="arrow-end" className="size-4" />
              </a>
            </article>
          </section>
        </div>
      )}
    </DemoShell>
  );
}

/** The open cycle as a card with its progress, the drafts to continue (Workable, 15Five). */
export const CyclesList: Story = {
  render: (_args, { globals }) => <CyclesPage globals={globals} />,
};

/** First use: how a cycle works, in three steps. */
export const CyclesFirstUse: Story = {
  render: (_args, { globals }) => <CyclesPage globals={globals} empty />,
};

/** The set-up: the side step list (✓ / ! / optional) and «Review & launch» with its problems. */
export const SetupReview: Story = {
  render: (_args, { globals }) => {
    const t = (copy: Copy) => pick(globals, copy);
    const attention = t({ ar: 'تحتاج إلى مراجعة', en: 'needs attention' });
    const optional = t({ ar: 'اختياري', en: 'optional' });
    const items: StepListItem[] = [
      {
        key: 'basics',
        label: t({ ar: 'الأساسيات', en: 'Basics' }),
        href: '#basics',
        state: 'problem',
        note: attention,
        srNote: `(${attention})`,
      },
      {
        key: 'scope',
        label: t({ ar: 'النطاق', en: 'Scope' }),
        href: '#scope',
        state: 'done',
        srNote: t({ ar: '(مكتملة)', en: '(completed)' }),
      },
      {
        key: 'budget',
        label: t({ ar: 'الميزانية', en: 'Budget' }),
        href: '#budget',
        state: 'todo',
        note: optional,
      },
      {
        key: 'approvals',
        label: t({ ar: 'سلسلة الاعتماد', en: 'Approval chain' }),
        href: '#approvals',
        state: 'problem',
        note: attention,
        srNote: `(${attention})`,
      },
      {
        key: 'reminders',
        label: t({ ar: 'التذكيرات', en: 'Reminders' }),
        href: '#reminders',
        state: 'todo',
        note: optional,
      },
      {
        key: 'review',
        label: t({ ar: 'المراجعة والإطلاق', en: 'Review & launch' }),
        href: '#review',
        state: 'todo',
        icon: 'flag',
      },
    ];
    const problems: { text: Copy; step: Copy }[] = [
      {
        text: {
          ar: 'انتهى الموعد النهائي. اختر تاريخًا لاحقًا في الأساسيات.',
          en: 'The deadline has passed. Choose a later date in Basics.',
        },
        step: { ar: 'الانتقال إلى الأساسيات', en: 'Go to Basics' },
      },
      {
        text: {
          ar: 'سمِّ المعتمد لكل خطوة شخص محدد.',
          en: 'Name the approver of every person step.',
        },
        step: { ar: 'الانتقال إلى سلسلة الاعتماد', en: 'Go to Approval chain' },
      },
    ];
    return (
      <DemoShell globals={globals} current="home">
        <PageHeader
          title={t(T.plan)}
          description={<Badge dot>{t({ ar: 'مسودة', en: 'Draft' })}</Badge>}
        />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[252px_minmax(0,1fr)] lg:gap-7">
          <StepList
            label={t({ ar: 'خطوات الإعداد', en: 'Set-up steps' })}
            items={items}
            current="review"
            short={t({
              ar: 'الخطوة 6 من 6 · المراجعة والإطلاق',
              en: 'Step 6 of 6 · Review & launch',
            })}
          />
          <div className="flex flex-col gap-4">
            <div className="rounded-[22px] border border-warning/40 bg-warning-subtle px-5.5 py-5">
              <h2 className="m-0 mb-3 text-[19px] font-bold">
                {t({ ar: 'قبل أن تتمكن من الإطلاق:', en: 'Before you can launch:' })}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {problems.map((p) => (
                  <li
                    key={p.text.en}
                    className="flex flex-wrap items-center gap-3 rounded-[14px] border border-warning/40 bg-surface py-2.5 pe-2.5 ps-3.5"
                  >
                    <span className="min-w-0 flex-1">{t(p.text)}</span>
                    <a href="#go" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                      {t(p.step)}
                      <Icon name="arrow-end" className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <Card title={t({ ar: 'الميزانية', en: 'Budget' })}>
              <p className="m-0 text-2xl font-bold">SAR 830,000.00</p>
            </Card>
            <div className="flex flex-wrap items-center gap-4 rounded-[22px] border border-border bg-surface px-5.5 py-4.5 shadow-2">
              <p id="story-why" className="m-0 flex-1 text-text-muted">
                {t({
                  ar: 'عالج الملاحظات أعلاه ثم أطلق الحملة.',
                  en: 'Fix the items above, then launch the cycle.',
                })}
              </p>
              <Button size="lg" disabled aria-describedby="story-why">
                <Icon name="flag" />
                {t({ ar: 'إطلاق الحملة', en: 'Launch cycle' })}
              </Button>
            </div>
          </div>
        </div>
      </DemoShell>
    );
  },
};

/** The course library: view cards as the status filter and filter pills that apply at once. */
export const CourseLibrary: Story = {
  render: (_args, { globals }) => {
    const t = (copy: Copy) => pick(globals, copy);
    return (
      <DemoShell globals={globals} current="home">
        <PageHeader
          title={t({ ar: 'الدورات', en: 'Courses' })}
          actions={
            <Button>
              <Icon name="plus" />
              {t({ ar: 'إضافة دورة', en: 'Add course' })}
            </Button>
          }
        />
        <div className="flex flex-col gap-5">
          <Alert tone="info">{t({ ar: 'دورات توضيحية.', en: 'Example courses.' })}</Alert>
          <ViewCards
            label={t({ ar: 'الحالة', en: 'Status' })}
            current="all"
            items={[
              {
                key: 'all',
                href: '#all',
                label: t({ ar: 'كل الدورات', en: 'All courses' }),
                count: '9',
              },
              {
                key: 'active',
                href: '#active',
                label: t({ ar: 'نشطة', en: 'Active' }),
                count: '8',
              },
              {
                key: 'archived',
                href: '#archived',
                label: t({ ar: 'مؤرشفة', en: 'Archived' }),
                count: '1',
              },
            ]}
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <ListSearch
              id="story-q"
              label={t({ ar: 'بحث', en: 'Search' })}
              placeholder={t({ ar: 'بحث', en: 'Search' })}
            />
            <FilterBar>
              <FilterMenu
                label={t({ ar: 'نوع التقديم', en: 'Delivery type' })}
                value={null}
                options={[
                  { value: 'classroom', label: t({ ar: 'حضوري', en: 'Classroom' }) },
                  { value: 'virtual', label: t({ ar: 'افتراضي', en: 'Virtual' }) },
                ]}
                allLabel={t({ ar: 'كل الأنواع', en: 'All delivery types' })}
                onChange={() => undefined}
                removeLabel="—"
              />
            </FilterBar>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2">
            <table className={tableClasses.table}>
              <caption className="sr-only">{t({ ar: 'الدورات', en: 'Courses' })}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t({ ar: 'الدورة', en: 'Course' })}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t({ ar: 'الحالة', en: 'Status' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className={tableClasses.row}>
                  <th scope="row" className={`${tableClasses.cell} text-start`}>
                    <span className="flex flex-col">
                      <bdi dir="ltr" className="font-mono text-[12.5px] text-text-muted">
                        LEAD-101
                      </bdi>
                      <span className="font-semibold">
                        {t({ ar: 'الإدارة الاستراتيجية', en: 'Strategic management' })}
                      </span>
                    </span>
                  </th>
                  <td className={tableClasses.cell}>
                    <Badge tone="success" dot>
                      {t({ ar: 'نشطة', en: 'Active' })}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </DemoShell>
    );
  },
};
