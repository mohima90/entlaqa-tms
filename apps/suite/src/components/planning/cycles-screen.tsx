'use client';
import type { DateDisplay } from '@jadarat/platform-i18n';
import type { CycleStatus } from '@jadarat/tms';
import type { LaunchProblem, ScopeSelection } from '@jadarat/tms/planning-rules';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  PageHeader,
  type PageHeaderProps,
  ProgressBar,
  ViewCards,
  buttonClasses,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { dayFormatter } from '../../lib/planning-format';
import {
  CYCLE_TONE,
  LIST_FILTERS,
  type ListFilter,
  PLANNING_PATHS,
  type PickerUnit,
  allUnitsScope,
  cycleHref,
  cycleSettingsHref,
  cyclesHref,
  daysLeft,
  filterCycles,
  unitsInScope,
} from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { DeleteCycleDialog, LaunchCycleDialog } from './cycle-action-buttons';
import { CycleDialog, type CycleDialogValues } from './cycle-dialog';
import { usePlanningTexts } from './use-planning-texts';

/** A needs form to choose, named in the page's language. */
export interface NeedsFormChoice {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly isDefault: boolean;
}

/** One cycle of the list. */
export interface CycleRow {
  readonly id: string;
  /** In the page's language (the other one when it is missing). */
  readonly name: string;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  /** As shown: an open cycle past its deadline is Closed. */
  readonly status: CycleStatus;
  readonly departmentCount: number;
  readonly submittedCount: number;
  /** A draft the member may change: what its row menu needs. Null otherwise. */
  readonly draft: {
    readonly version: number;
    readonly needsFormId: string | null;
    /** The cycle's own form when it was switched off since (C-6). */
    readonly needsFormOff: NeedsFormChoice | null;
    readonly scope: ScopeSelection;
    readonly problems: readonly LaunchProblem[];
  } | null;
}

/** Which popup the page opens with (its address: `?new=1`, `?edit=<id>`, `?launch=<id>`). */
export type CyclesOpen =
  { readonly kind: 'new' } | { readonly kind: 'edit' | 'launch'; readonly id: string } | null;

export interface CyclesScreenProps {
  readonly locale: 'ar' | 'en';
  /** The page header (title, intro, breadcrumb): the screen adds «New cycle» as its primary action. */
  readonly header: Pick<
    PageHeaderProps,
    'title' | 'description' | 'breadcrumbs' | 'breadcrumbsLabel'
  >;
  /** The organization's today (calendar day); '' in the preview without data. */
  readonly today: string;
  readonly cycles: readonly CycleRow[];
  /** The summary card that filters the table (`?status=`). */
  readonly filter: ListFilter;
  readonly counts: Readonly<Record<ListFilter, number>>;
  /** The member starts and changes cycles (the L&D Manager); others read. */
  readonly canManage: boolean;
  /** What the popup offers; null for readers. */
  readonly setup: {
    readonly defaults: {
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly deadline: string;
    };
    readonly nameLanguage: 'ar' | 'en';
    readonly units: readonly PickerUnit[];
    /** The organization's branches (a branch brings every department in it). */
    readonly branches: readonly {
      readonly id: string;
      readonly name: string;
      readonly active: boolean;
    }[];
    readonly needsForms: readonly NeedsFormChoice[];
  } | null;
  readonly open: CyclesOpen;
  /** The member picks heads under Organization → Departments (the launch question links there). */
  readonly canPickHeads: boolean;
  readonly display: DateDisplay;
  /** «Needs forms» (the menu entry). */
  readonly needsFormsLabel: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

type OpenDialog =
  | { readonly kind: 'new' }
  | { readonly kind: 'edit' | 'launch' | 'delete'; readonly id: string }
  | null;

const NEW_CYCLE_ID = 'new-cycle';
const menuId = (id: string) => `cycle-menu-${id}`;

/**
 * Planning → Cycles (EP-PLN screen 3; the Kawadir pattern — forms standard rule 9, WP-UX-01 a / T-M3-20):
 * the primary action «New cycle» in the page header, four summary cards that filter the table (All, Draft,
 * Open, Closed — each its own address), the cycles as a table in a card (one card per cycle on phones) and
 * an empty state that offers the first cycle. A draft's row menu: Edit (the popup, pre-filled), Settings,
 * Launch cycle (a small confirmation) and Delete draft. A launched cycle's row says how many departments
 * submitted and how many days are left, and opens its progress. Readers see the same list without actions.
 */
export function CyclesScreen(props: CyclesScreenProps) {
  const { t } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const { locale, setup } = props;
  const day = dayFormatter(locale, props.display);
  const number = new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 0 });
  const [dialog, setDialog] = useState<OpenDialog>(() => {
    if (!props.canManage || !setup || !props.open) return null;
    if (props.open.kind === 'new') return props.open;
    const id = props.open.id;
    // Only a draft the member may change can be edited or launched.
    return props.cycles.some((cycle) => cycle.id === id && cycle.draft) ? props.open : null;
  });
  // The control that opened the dialog (the row menu's button, or «New cycle»): focus goes back to it.
  const returnTo = useRef<string>(NEW_CYCLE_ID);

  // The popup came with the address: taken out of it, so a reload or a shared link does not reopen it.
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ['new', 'edit', 'launch']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    }
  }, []);

  const open = (next: Exclude<OpenDialog, null>, from: string) => {
    returnTo.current = from;
    setDialog(next);
  };
  const close = () => {
    setDialog(null);
    // After the dialog has closed: back to the control that opened it; «New cycle» if it is gone.
    window.setTimeout(() => {
      (document.getElementById(returnTo.current) ?? document.getElementById(NEW_CYCLE_ID))?.focus();
    }, 0);
  };

  const shown = filterCycles(props.cycles, props.filter);
  const selected =
    dialog && dialog.kind !== 'new' ? props.cycles.find((cycle) => cycle.id === dialog.id) : null;
  const draft = selected?.draft ?? null;

  const newCycleButton = (id?: string) =>
    props.canManage && setup ? (
      <Button
        id={id}
        onClick={() => {
          open({ kind: 'new' }, id ?? NEW_CYCLE_ID);
        }}
        data-testid={id ? 'new-cycle' : 'new-cycle-empty'}
      >
        <Icon name="plus" />
        {t('list.newCycle')}
      </Button>
    ) : null;

  const departments = (cycle: CycleRow) =>
    cycle.status === 'draft'
      ? t('list.departmentCount', { count: cycle.departmentCount })
      : t('list.submitted', {
          submitted: number.format(cycle.submittedCount),
          count: number.format(cycle.departmentCount),
        });

  const actions = (cycle: CycleRow) => {
    if (cycle.draft) {
      const from = menuId(cycle.id);
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            id={from}
            className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
            aria-label={t('list.rowMenu', { name: cycle.name })}
            data-testid="cycle-menu"
          >
            <Icon name="more" />
          </DropdownMenuTrigger>
          {/* The trigger has its own id (the focus returns to it), so the menu is named here. */}
          <DropdownMenuContent aria-label={t('list.rowMenu', { name: cycle.name })}>
            <DropdownMenuItem
              onSelect={() => {
                open({ kind: 'edit', id: cycle.id }, from);
              }}
              data-testid="cycle-menu-edit"
            >
              <Icon name="pencil" />
              {t('list.menu.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={cycleSettingsHref(locale, cycle.id)} data-testid="cycle-menu-settings">
                <Icon name="settings" />
                {t('list.menu.settings')}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                open({ kind: 'launch', id: cycle.id }, from);
              }}
              data-testid="cycle-menu-launch"
            >
              <Icon name="flag" />
              {t('list.menu.launch')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              onSelect={() => {
                open({ kind: 'delete', id: cycle.id }, from);
              }}
              data-testid="cycle-menu-delete"
            >
              <Icon name="trash" />
              {t('list.menu.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    // A launched cycle (and a draft for readers): its page — the progress of the departments.
    return cycle.status === 'draft' ? (
      <a
        href={cycleHref(locale, cycle.id)}
        className="inline-grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        aria-label={t('list.openCycle', { name: cycle.name })}
        data-testid="cycle-open-link"
      >
        <Icon name="chevron-end" />
      </a>
    ) : (
      <a
        href={cycleHref(locale, cycle.id)}
        className={buttonClasses({
          variant: 'secondary',
          size: 'sm',
          className: 'whitespace-nowrap',
        })}
        aria-label={t('list.progressOf', { name: cycle.name })}
        data-testid="cycle-open-link"
      >
        {t('list.viewProgress')}
      </a>
    );
  };

  /** The label of a cell on phones, where the column headers are not shown. */
  const cellLabel = (key: 'period' | 'deadline') => (
    <span className="text-text-muted md:hidden">{t(`list.columns.${key}`)}: </span>
  );

  return (
    <>
      <PageHeader {...props.header} actions={newCycleButton(NEW_CYCLE_ID)} />

      {/* The summary cards filter the table: each is its own address, the current one marked. */}
      <ViewCards
        label={t('list.tabsLabel')}
        current={props.filter}
        items={LIST_FILTERS.map((key) => ({
          key,
          href: cyclesHref(locale, { filter: key }),
          label: t(`list.stats.${key === 'all' ? 'total' : key}`),
          count: number.format(props.counts[key]),
          testId: `cycles-stat-${key}`,
        }))}
        className="mb-5"
        data-testid="cycles-stats"
      />

      {props.cycles.length === 0 ? (
        <section
          className="rounded-xl border border-border bg-surface shadow-2"
          data-testid="cycles-empty"
        >
          <EmptyState
            icon="flag"
            title={t('list.emptyTitle')}
            description={props.canManage ? t('list.emptyBody') : t('list.emptyReadBody')}
            steps={
              props.canManage
                ? (['how1', 'how2', 'how3'] as const).map((key) => ({ title: t(`list.${key}`) }))
                : undefined
            }
            stepsTitle={t('list.howTitle')}
          />
          {props.canManage && setup ? (
            <div className="-mt-5 flex justify-center pb-10">{newCycleButton()}</div>
          ) : null}
        </section>
      ) : shown.length === 0 ? (
        <section
          className="rounded-xl border border-border bg-surface shadow-2"
          data-testid="cycles-empty-filter"
        >
          <EmptyState
            icon="flag"
            title={t('list.emptyTabTitle')}
            description={t('list.emptyTabBody')}
            action={
              <a
                href={cyclesHref(locale)}
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
              >
                {t('list.showAll')}
              </a>
            }
          />
        </section>
      ) : (
        <section
          aria-label={t('list.tableCaption')}
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
        >
          {/* One table; on phones each row reads as a card (no second set of row menus). */}
          <table className={`${tableClasses.table} max-md:block`} data-testid="cycles-table">
            <caption className="sr-only">{t('list.tableCaption')}</caption>
            <thead className={`${tableClasses.header} max-md:hidden`}>
              <tr>
                {(['name', 'period', 'deadline', 'status', 'departments'] as const).map((key) => (
                  <th key={key} scope="col" className={tableClasses.head}>
                    {t(`list.columns.${key}`)}
                  </th>
                ))}
                <th scope="col" className={`${tableClasses.head} text-end`}>
                  {t('list.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {shown.map((cycle) => {
                const left =
                  cycle.status === 'open' && props.today
                    ? Math.max(daysLeft(props.today, cycle.deadline), 0)
                    : null;
                const mobile = 'max-md:col-start-1 max-md:h-auto max-md:p-0';
                return (
                  <tr
                    key={cycle.id}
                    className={`${tableClasses.row} max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-4 max-md:py-3.5`}
                    data-testid="cycle-row"
                    data-status={cycle.status}
                  >
                    <th
                      scope="row"
                      className={`${tableClasses.cell} ${mobile} text-start font-semibold [overflow-wrap:anywhere] max-md:self-center max-md:first:ps-0`}
                    >
                      <a
                        href={
                          cycle.draft
                            ? cycleSettingsHref(locale, cycle.id)
                            : cycleHref(locale, cycle.id)
                        }
                        data-testid="cycle-name"
                      >
                        {cycle.name}
                      </a>
                    </th>
                    <td className={`${tableClasses.cell} ${mobile} text-sm`}>
                      {cellLabel('period')}
                      {day(cycle.periodStart)} – {day(cycle.periodEnd)}
                    </td>
                    <td className={`${tableClasses.cell} ${mobile} text-sm`}>
                      {cellLabel('deadline')}
                      {day(cycle.deadline)}
                    </td>
                    <td className={`${tableClasses.cell} ${mobile}`}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={CYCLE_TONE[cycle.status]} dot data-testid="cycle-status">
                          {t(`status.${cycle.status}`)}
                        </Badge>
                        {left !== null ? (
                          <span
                            className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-text"
                            data-testid="cycle-days-left"
                          >
                            <Icon name="clock" className="size-3.5" />
                            {t('list.daysLeft', { count: left })}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={`${tableClasses.cell} ${mobile} text-sm`}>
                      <span className="flex flex-col gap-1.5 md:max-w-44">
                        <span data-testid="cycle-departments">{departments(cycle)}</span>
                        {cycle.status === 'draft' ? null : (
                          <ProgressBar
                            value={cycle.submittedCount}
                            max={cycle.departmentCount}
                            label={departments(cycle)}
                            className="h-1.5"
                          />
                        )}
                      </span>
                    </td>
                    <td
                      className={`${tableClasses.cell} text-end max-md:col-start-2 max-md:row-start-1 max-md:h-auto max-md:p-0`}
                    >
                      {actions(cycle)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="m-0 border-t border-border px-5 py-3 text-[13px] text-text-muted max-md:px-4">
            {t('list.cardDescription')}
          </p>
        </section>
      )}

      {props.canManage && setup ? (
        <>
          <CycleDialog
            locale={locale}
            open={dialog?.kind === 'new' || (dialog?.kind === 'edit' && draft !== null)}
            onClose={close}
            editing={
              dialog?.kind === 'edit' && selected && draft
                ? {
                    id: selected.id,
                    version: draft.version,
                    name: selected.name,
                  }
                : null
            }
            initial={
              dialog?.kind === 'edit' && selected && draft
                ? editValues(selected, draft)
                : newValues(setup)
            }
            units={setup.units}
            branches={setup.branches}
            needsForms={
              dialog?.kind === 'edit' && draft?.needsFormOff
                ? [...setup.needsForms, draft.needsFormOff]
                : setup.needsForms
            }
            nameLanguage={setup.nameLanguage}
            display={props.display}
            needsFormsLabel={props.needsFormsLabel}
            texts={props.texts}
            errors={props.errors}
            onSaved={({ created, name }) => {
              toast.success(created ? t('list.created', { name }) : t('list.updated'));
              close();
              // A new draft shows under «All» and «Draft»: another filter would hide it.
              if (created && props.filter !== 'all' && props.filter !== 'draft') {
                router.push(cyclesHref(locale));
              }
              router.refresh();
            }}
          />
          {selected && draft && dialog?.kind === 'launch' ? (
            <LaunchCycleDialog
              locale={locale}
              open
              onClose={close}
              cycle={{ id: selected.id, version: draft.version }}
              name={selected.name}
              deadline={day(selected.deadline)}
              departments={unitsInScope(setup.units, draft.scope).map((unit) => ({
                id: unit.id,
                name: unit.name,
                head: unit.head,
              }))}
              problems={draft.problems}
              editHref={cyclesHref(locale, { open: { kind: 'edit', id: selected.id } })}
              settingsHref={cycleSettingsHref(locale, selected.id, 'form')}
              structureHref={props.canPickHeads ? `/${locale}${PLANNING_PATHS.structure}` : null}
              launchedHref={`${cycleHref(locale, selected.id)}?launched=1`}
              texts={props.texts}
              errors={props.errors}
            />
          ) : null}
          {selected && draft && dialog?.kind === 'delete' ? (
            <DeleteCycleDialog
              locale={locale}
              open
              onClose={close}
              cycle={{ id: selected.id, version: draft.version }}
              name={selected.name}
              onDeleted={() => {
                toast.success(t('list.deleted'));
                // The row is gone: focus goes to «New cycle».
                returnTo.current = NEW_CYCLE_ID;
                close();
                router.refresh();
              }}
              texts={props.texts}
              errors={props.errors}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** A new cycle as the popup opens: the suggested period and deadline, every department, the default form. */
function newValues(setup: NonNullable<CyclesScreenProps['setup']>): CycleDialogValues {
  return {
    nameAr: '',
    nameEn: '',
    ...setup.defaults,
    // The organization's default form is preselected (T-M3-10); the launch locks the chosen form.
    needsFormId: setup.needsForms.find((form) => form.isDefault)?.id ?? '',
    scope: { departmentIds: allUnitsScope(setup.units), branchIds: [] },
  };
}

function editValues(cycle: CycleRow, draft: NonNullable<CycleRow['draft']>): CycleDialogValues {
  return {
    nameAr: cycle.nameAr ?? '',
    nameEn: cycle.nameEn ?? '',
    periodStart: cycle.periodStart,
    periodEnd: cycle.periodEnd,
    deadline: cycle.deadline,
    needsFormId: draft.needsFormId ?? '',
    scope: draft.scope,
  };
}
