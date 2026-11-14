import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { DemoShell } from '../.storybook/demo-shell';
import { type Copy, pick } from '../.storybook/l10n';
import { Alert } from './alert';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Card } from './card';
import { Dialog } from './dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { EmptyState } from './empty-state';
import { Icon } from './icons';
import { FilterBar, FilterMenu, ListSearch, ViewCards } from './index';
import { PageHeader } from './page-header';
import { ProgressBar } from './progress-bar';
import { TabNav } from './tab-nav';
import { tableClasses } from './table';
import { TextField, fieldInputClasses } from './text-field';

/**
 * Planning & courses. The planning cycle follows the Kawadir pattern (forms standard rule 9; the pilot of
 * WP-UX-01 a, approved by the PO from the mock-up on 12 Nov 2026): the cycles list — the primary action in
 * the header, summary cards that filter, a table in a card, a row menu on drafts —, «New cycle» as one
 * centred 672 px popup, the launch as a small confirmation from the row menu, and the cycle's optional
 * Settings with tabs at the side. The course library (redesign package 4) keeps view cards and instant
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
    ar: 'اسأل كل إدارة عن احتياجات فريقها التدريبية، ثم ابنِ منها خطة واحدة.',
    en: 'Ask every department what training its team needs, then build one plan.',
  },
  newCycle: { ar: 'حملة جديدة', en: 'New cycle' },
  plan: { ar: 'خطة التدريب 2027', en: 'Training plan 2027' },
  planOpen: { ar: 'خطة التدريب 2026', en: 'Training plan 2026' },
  draft: { ar: 'مسودة', en: 'Draft' },
  open: { ar: 'مفتوحة', en: 'Open' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  close: { ar: 'إغلاق', en: 'Close' },
  noHead: { ar: 'بلا رئيس بعد', en: 'No head yet' },
  hr: { ar: 'الموارد البشرية', en: 'Human Resources' },
  finance: { ar: 'المالية', en: 'Finance' },
  sales: { ar: 'المبيعات', en: 'Sales' },
  sara: { ar: 'سارة علي', en: 'Sara Ali' },
  omar: { ar: 'عمر ناصر', en: 'Omar Nasser' },
  launchCycle: { ar: 'إطلاق الحملة', en: 'Launch cycle' },
} as const satisfies Record<string, Copy>;

const DEPARTMENTS = [
  { name: T.hr, head: T.sara },
  { name: T.finance, head: T.omar },
  { name: T.sales, head: null },
] as const;

/** The cycles list: header action, summary cards that filter, the cycles in a table with a row menu. */
function CyclesPage({ globals, empty = false }: { globals: Globals; empty?: boolean }) {
  const t = (copy: Copy) => pick(globals, copy);
  const columns: Copy[] = [
    { ar: 'الحملة', en: 'Cycle' },
    { ar: 'فترة الخطة', en: 'Plan period' },
    { ar: 'الموعد النهائي للاحتياجات', en: 'Needs deadline' },
    { ar: 'الحالة', en: 'Status' },
    { ar: 'الإدارات', en: 'Departments' },
    { ar: 'الإجراءات', en: 'Actions' },
  ];
  const submitted = t({ ar: 'أُرسل 2 من 3', en: '2 of 3 submitted' });
  const mobile = 'max-md:col-start-1 max-md:h-auto max-md:p-0';
  const row = `${tableClasses.row} max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-4 max-md:py-3.5`;
  const actionsCell = `${tableClasses.cell} text-end max-md:col-start-2 max-md:row-start-1 max-md:h-auto max-md:p-0`;
  return (
    <DemoShell globals={globals} current="home">
      <PageHeader
        title={t(T.cycles)}
        description={t(T.intro)}
        actions={
          <Button>
            <Icon name="plus" />
            {t(T.newCycle)}
          </Button>
        }
      />
      <ViewCards
        label={t({ ar: 'عرض الحملات حسب الحالة', en: 'Show cycles by status' })}
        current="all"
        className="mb-5"
        items={[
          {
            key: 'all',
            href: '#all',
            label: t({ ar: 'كل الحملات', en: 'All cycles' }),
            count: empty ? '0' : '2',
          },
          {
            key: 'draft',
            href: '#draft',
            label: t({ ar: 'المسودات', en: 'Draft' }),
            count: empty ? '0' : '1',
          },
          {
            key: 'open',
            href: '#open',
            label: t({ ar: 'المفتوحة', en: 'Open' }),
            count: empty ? '0' : '1',
          },
          { key: 'closed', href: '#closed', label: t({ ar: 'المغلقة', en: 'Closed' }), count: '0' },
        ]}
      />
      {empty ? (
        <section className="rounded-xl border border-border bg-surface shadow-2">
          <EmptyState
            icon="flag"
            title={t({ ar: 'لا توجد حملات حصر احتياجات بعد', en: 'No planning cycles yet' })}
            description={t({
              ar: 'ابدأ حملة لجمع الاحتياجات التدريبية لإداراتك.',
              en: 'Start a cycle to collect the training needs of your departments.',
            })}
            stepsTitle={t({ ar: 'كيف تعمل حملة حصر الاحتياجات', en: 'How a planning cycle works' })}
            steps={[
              {
                title: t({
                  ar: 'أنشئ الحملة: اسمها وفترة الخطة والموعد النهائي للاحتياجات والإدارات.',
                  en: 'Create the cycle: its name, the plan period, the needs deadline and the departments.',
                }),
              },
              {
                title: t({
                  ar: 'أطلق الحملة: يصل نموذج الاحتياجات إلى رئيس كل إدارة مع الموعد النهائي.',
                  en: 'Launch: every department head gets a needs form with your deadline.',
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
          <div className="-mt-5 flex justify-center pb-10">
            <Button>
              <Icon name="plus" />
              {t(T.newCycle)}
            </Button>
          </div>
        </section>
      ) : (
        <section
          aria-label={t(T.cycles)}
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
        >
          <table className={`${tableClasses.table} max-md:block`}>
            <caption className="sr-only">{t(T.cycles)}</caption>
            <thead className={`${tableClasses.header} max-md:hidden`}>
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={column.en}
                    scope="col"
                    className={`${tableClasses.head} ${index === columns.length - 1 ? 'text-end' : ''}`}
                  >
                    {t(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-md:block">
              <tr className={row}>
                <th
                  scope="row"
                  className={`${tableClasses.cell} ${mobile} text-start font-semibold`}
                >
                  <a href="#settings">{t(T.plan)}</a>
                </th>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>Jan 1 – Dec 31, 2027</td>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>Dec 15, 2026</td>
                <td className={`${tableClasses.cell} ${mobile}`}>
                  <Badge dot>{t(T.draft)}</Badge>
                </td>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>
                  {t({ ar: '3 إدارات', en: '3 departments' })}
                </td>
                <td className={actionsCell}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                      aria-label={t({
                        ar: 'إجراءات خطة التدريب 2027',
                        en: 'Actions for Training plan 2027',
                      })}
                    >
                      <Icon name="more" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem>
                        <Icon name="pencil" />
                        {t({ ar: 'تعديل', en: 'Edit' })}
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Icon name="settings" />
                        {t({ ar: 'الإعدادات', en: 'Settings' })}
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Icon name="flag" />
                        {t(T.launchCycle)}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem tone="danger">
                        <Icon name="trash" />
                        {t({ ar: 'حذف المسودة', en: 'Delete draft' })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
              <tr className={row}>
                <th
                  scope="row"
                  className={`${tableClasses.cell} ${mobile} text-start font-semibold`}
                >
                  <a href="#progress">{t(T.planOpen)}</a>
                </th>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>Jan 1 – Dec 31, 2026</td>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>Nov 20, 2026</td>
                <td className={`${tableClasses.cell} ${mobile}`}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="success" dot>
                      {t(T.open)}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-text">
                      <Icon name="clock" className="size-3.5" />
                      {t({ ar: 'بقيت 8 أيام', en: '8 days left' })}
                    </span>
                  </span>
                </td>
                <td className={`${tableClasses.cell} ${mobile} text-sm`}>
                  <span className="flex flex-col gap-1.5 md:max-w-44">
                    <span>{submitted}</span>
                    <ProgressBar value={2} max={3} label={submitted} className="h-1.5" />
                  </span>
                </td>
                <td className={actionsCell}>
                  <a
                    href="#progress"
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                    aria-label={t({
                      ar: 'عرض التقدم في خطة التدريب 2026',
                      en: 'View progress of Training plan 2026',
                    })}
                  >
                    {t({ ar: 'عرض التقدم', en: 'View progress' })}
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </DemoShell>
  );
}

/** The list: summary cards that filter, a draft with its row menu, the open cycle with its progress. */
export const CyclesList: Story = {
  render: (_args, { globals }) => <CyclesPage globals={globals} />,
};

/** First use: how a cycle works, in three steps, and the first cycle offered. */
export const CyclesFirstUse: Story = {
  render: (_args, { globals }) => <CyclesPage globals={globals} empty />,
};

function NewCycleDemo({ globals }: { globals: Globals }) {
  const t = (copy: Copy) => pick(globals, copy);
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="bg-bg p-6">
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="plus" />
        {t(T.newCycle)}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        size="rich"
        title={t({ ar: 'حملة حصر احتياجات جديدة', en: 'New planning cycle' })}
        description={t({
          ar: 'يصل نموذج الاحتياجات إلى رؤساء الإدارات عند إطلاق الحملة. يمكنك تعديل كل شيء قبل ذلك.',
          en: 'Department heads get a needs form when you launch it. You can change everything until then.',
        })}
        closeLabel={t(T.close)}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t(T.cancel)}
            </Button>
            <Button onClick={close}>{t({ ar: 'إنشاء الحملة', en: 'Create cycle' })}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            id="story-new-name-en"
            label={t({ ar: 'اسم الحملة (بالإنجليزية)', en: 'Cycle name (English)' })}
            defaultValue="Training plan 2027"
            dir="ltr"
            lang="en"
            required
          />
          <TextField
            id="story-new-name-ar"
            label={t({ ar: 'اسم الحملة (بالعربية)', en: 'Cycle name (Arabic)' })}
            dir="rtl"
            lang="ar"
          />
        </div>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
          <TextField
            id="story-new-start"
            type="date"
            label={t({ ar: 'بداية الخطة', en: 'Plan starts' })}
            defaultValue="2027-01-01"
            required
          />
          <TextField
            id="story-new-end"
            type="date"
            label={t({ ar: 'نهاية الخطة', en: 'Plan ends' })}
            defaultValue="2027-12-31"
            required
          />
          <TextField
            id="story-new-deadline"
            type="date"
            label={t({ ar: 'الموعد النهائي للاحتياجات', en: 'Needs deadline' })}
            defaultValue="2026-12-15"
            required
          />
        </div>
        <hr className="m-0 border-0 border-t border-border" />
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold">
            {t({ ar: 'الإدارات في هذه الحملة', en: 'Departments in this cycle' })}
          </legend>
          <label className="flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-semibold pointer-coarse:min-h-11">
            <input type="checkbox" defaultChecked className="size-5 shrink-0 accent-primary" />
            {t({ ar: 'كل الإدارات (3)', en: 'All departments (3)' })}
          </label>
          <ul className="m-0 flex list-none flex-col gap-0.5 rounded-xl border border-border p-1.5">
            {DEPARTMENTS.map((department) => (
              <li key={department.name.en}>
                <label className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 text-sm pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="size-5 shrink-0 accent-primary"
                  />
                  <span className="font-medium">{t(department.name)}</span>
                  {department.head ? (
                    <span className="text-[13px] text-text-muted">
                      {t({ ar: 'الرئيس:', en: 'Head:' })} {t(department.head)}
                    </span>
                  ) : (
                    <Badge tone="warning">{t(T.noHead)}</Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="story-new-form" className="text-sm font-semibold">
            {t({ ar: 'نموذج الاحتياجات', en: 'Needs form' })}
          </label>
          <select id="story-new-form" className={`${fieldInputClasses} select-chevron pe-10`}>
            <option>{t({ ar: 'نموذج الاحتياجات الافتراضي', en: 'Default needs form' })}</option>
          </select>
        </div>
        <p className="m-0 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-text-muted">
          {t({
            ar: 'الميزانيات والتعليمات والتذكيرات اختيارية، وتضيفها لاحقًا من إعدادات الحملة. الاعتماد واحد في كل الحملات: يعتمد مدير الموارد البشرية الخطة، ثم تؤكدها المالية إن كانت منظمتك تستخدم هذه الخطوة.',
            en: 'Budgets, instructions and reminders are optional. Add them later from the cycle’s Settings. Approval is the same for every cycle: the HR Manager approves. Finance confirms after that, if your organization uses that step.',
          })}
        </p>
      </Dialog>
    </div>
  );
}

/**
 * «New cycle»: one centred popup, 672 px — the name in the organization's default language (required, a red
 * asterisk) and in the other one, the plan period, the needs deadline, the departments (all by default,
 * each with its head or «No head yet») and the needs form; «Cancel», then «Create cycle».
 */
export const NewCyclePopup: Story = {
  render: (_args, { globals }) => <NewCycleDemo globals={globals} />,
};

function LaunchDemo({ globals }: { globals: Globals }) {
  const t = (copy: Copy) => pick(globals, copy);
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="bg-bg p-6">
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="flag" />
        {t(T.launchCycle)}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t({ ar: 'إطلاق خطة التدريب 2027؟', en: 'Launch Training plan 2027?' })}
        description={t({
          ar: 'يصل نموذج الاحتياجات إلى 3 إدارات، ويعبّئه رؤساؤها حتى 15 ديسمبر 2026. بعد الإطلاق لا يمكن إلا تمديد الموعد النهائي.',
          en: '3 departments get the needs form. Their heads fill it in until Dec 15, 2026. After launch you can only extend the deadline.',
        })}
        closeLabel={t(T.close)}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t(T.cancel)}
            </Button>
            <Button onClick={close}>
              <Icon name="flag" />
              {t({ ar: 'إطلاق', en: 'Launch' })}
            </Button>
          </>
        }
      >
        <ul
          aria-label={t({ ar: 'الإدارات ورؤساؤها', en: 'Departments and their heads' })}
          className="m-0 flex list-none flex-col rounded-xl border border-border p-0"
        >
          {DEPARTMENTS.map((department) => (
            <li
              key={department.name.en}
              className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3.5 py-2 text-sm last:border-b-0"
            >
              <span className="font-medium">{t(department.name)}</span>
              {department.head ? (
                <span className="text-text-muted">{t(department.head)}</span>
              ) : (
                <Badge tone="warning">{t(T.noHead)}</Badge>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3">
          <p className="m-0 min-w-0 flex-1 text-sm">
            {t({
              ar: 'المبيعات بلا رئيس، فلن يعبّئ نموذجها أحد. يمكنك الإطلاق الآن واختيار الرئيس لاحقًا.',
              en: 'Sales has no head, so nobody can fill in its form. You can launch now and pick the head later.',
            })}
          </p>
          <a href="#structure" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            {t({ ar: 'اختيار رئيس لـ المبيعات', en: 'Pick a head for Sales' })}
          </a>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * «Launch cycle» from the row menu: a small confirmation — how many departments get the form and until
 * when, the departments with their heads, and a warning for a department nobody can answer for.
 */
export const LaunchConfirmation: Story = {
  render: (_args, { globals }) => <LaunchDemo globals={globals} />,
};

/**
 * The cycle's optional Settings: tabs at the side (rows above the content below 1200 px), the open section
 * with its fields, «Launch cycle» in the header; the save bar appears once something changed.
 */
export const CycleSettings: Story = {
  render: (_args, { globals }) => {
    const t = (copy: Copy) => pick(globals, copy);
    const budgets = ['150,000', '300,000', ''];
    return (
      <DemoShell globals={globals} current="home">
        <PageHeader
          title={t(T.plan)}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge dot>{t(T.draft)}</Badge>
              {t({
                ar: 'إعدادات الحملة · كل ما هنا اختياري',
                en: 'Cycle settings · all of this is optional',
              })}
            </span>
          }
          actions={
            <Button variant="secondary">
              <Icon name="flag" />
              {t(T.launchCycle)}
            </Button>
          }
        />
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6">
          <TabNav
            variant="side"
            label={t({ ar: 'إعدادات الحملة', en: 'Cycle settings' })}
            current="departments"
            items={[
              {
                key: 'departments',
                href: '#departments',
                icon: 'structure',
                label: t({ ar: 'الإدارات والميزانيات', en: 'Departments & budgets' }),
              },
              {
                key: 'instructions',
                href: '#instructions',
                icon: 'info',
                label: t({ ar: 'تعليمات للرؤساء', en: 'Instructions to heads' }),
              },
              {
                key: 'reminders',
                href: '#reminders',
                icon: 'bell',
                label: t({ ar: 'التذكيرات', en: 'Reminders' }),
              },
              {
                key: 'form',
                href: '#form',
                icon: 'flag',
                label: t({ ar: 'نموذج الاحتياجات', en: 'Needs form' }),
              },
            ]}
          />
          <Card
            title={t({ ar: 'الإدارات والميزانيات', en: 'Departments & budgets' })}
            description={t({
              ar: 'حدّد ميزانية للإدارة إن أردت. يراها رئيسها أثناء التخطيط؛ تنبّه ولا تمنع.',
              en: 'Give a department a budget if you want one. Its head sees it while planning. It warns, it never blocks.',
            })}
            headingLevel={2}
          >
            <div className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-2xl border border-border">
                <table className={`${tableClasses.table} max-md:block`}>
                  <caption className="sr-only">
                    {t({ ar: 'الإدارات والميزانيات', en: 'Departments & budgets' })}
                  </caption>
                  <thead className={`${tableClasses.header} max-md:hidden`}>
                    <tr>
                      <th scope="col" className={tableClasses.head}>
                        {t({ ar: 'الإدارة', en: 'Department' })}
                      </th>
                      <th scope="col" className={tableClasses.head}>
                        {t({ ar: 'الرئيس', en: 'Head' })}
                      </th>
                      <th scope="col" className={tableClasses.head}>
                        {t({ ar: 'الميزانية (EGP)', en: 'Budget (EGP)' })}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="max-md:block">
                    {DEPARTMENTS.map((department, index) => (
                      <tr
                        key={department.name.en}
                        className={`${tableClasses.row} max-md:flex max-md:flex-col max-md:gap-2 max-md:px-4 max-md:py-3.5`}
                      >
                        <th
                          scope="row"
                          className={`${tableClasses.cell} text-start font-medium max-md:h-auto max-md:p-0`}
                        >
                          {t(department.name)}
                        </th>
                        <td
                          className={`${tableClasses.cell} text-text-muted max-md:h-auto max-md:p-0`}
                        >
                          {department.head ? (
                            t(department.head)
                          ) : (
                            <a
                              href="#structure"
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                              aria-label={t({
                                ar: 'اختيار رئيس لـ المبيعات',
                                en: 'Pick a head for Sales',
                              })}
                            >
                              {t({ ar: 'اختيار رئيس', en: 'Pick a head' })}
                            </a>
                          )}
                        </td>
                        <td className={`${tableClasses.cell} py-2 max-md:h-auto max-md:p-0`}>
                          <input
                            aria-label={`${t({ ar: 'ميزانية', en: 'Budget for' })} ${t(department.name)}`}
                            inputMode="decimal"
                            dir="ltr"
                            defaultValue={budgets[index]}
                            placeholder={t({ ar: 'بلا ميزانية', en: 'No budget' })}
                            className={`${fieldInputClasses} min-h-[42px] text-end tabular-nums md:w-50`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <Button variant="secondary">
                  <Icon name="structure" />
                  {t({ ar: 'إضافة إدارات أو إزالتها', en: 'Add or remove departments' })}
                </Button>
                <p className="m-0 ms-auto text-[15px]">
                  {t({ ar: 'مجموع الميزانيات:', en: 'Total of the budgets:' })}{' '}
                  <b className="tabular-nums">EGP 450,000.00</b>
                </p>
              </div>
            </div>
          </Card>
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
