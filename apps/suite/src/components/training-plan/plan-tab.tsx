'use client';
import type { PlanView } from '@jadarat/tms';
import { bringBackPlanLineAction, syncPlanNeedsAction } from '@jadarat/tms/actions/consolidation';
import { PLAN_GROUPINGS, type PlanGrouping } from '@jadarat/tms/consolidation-rules';
import {
  AttentionItem,
  AttentionStrip,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ListSearch,
  StatCard,
  StatGrid,
  cn,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useRef, useState, useTransition } from 'react';
import {
  type PlanLine,
  type PlanSubview,
  lineMatches,
  visibleGroups,
} from '../../lib/training-plan-view';
import type { ErrorTexts } from '../auth/error-text';
import { BudgetView } from './budget-view';
import { LeaveOutDialog, MergeDialog, QuarterDialog } from './plan-dialogs';
import { PlanLineDialog } from './plan-line-dialog';
import { BudgetMeter, LineStatusBadge, QuarterChip, planModel } from './plan-shared';
import { usePlanTexts } from './use-plan-texts';

export interface PlanTabProps {
  readonly locale: 'ar' | 'en';
  readonly view: PlanView;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly initialSubview: PlanSubview;
  readonly initialGrouping: PlanGrouping;
}

type Dialogs =
  | { readonly kind: 'line'; readonly line: PlanLine }
  | { readonly kind: 'merge'; readonly lines: readonly PlanLine[] }
  | { readonly kind: 'leaveOut'; readonly line: PlanLine }
  | { readonly kind: 'quarter'; readonly lines: readonly PlanLine[] }
  | null;

/** Keeps the view and grouping in the address (deep links, back to the same place after a reload). */
/**
 * Keeps the view and the grouping in the address through the router (not `history.replaceState`): a later
 * `router.refresh()` after a change rewrites the address from the router's own state and would drop them.
 */
function rememberInAddress(
  router: ReturnType<typeof useRouter>,
  values: Readonly<Record<string, string | null>>,
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  router.replace(`${url.pathname}${url.search}`, { scroll: false });
}

/**
 * The Plan tab of a cycle (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06; approved design screens 1, 1p and 3,
 * docs/design/screens/m3-consolidation-approval/README.md): the four summary cards, «Needs your attention»,
 * the switch between the plan lines and the budget by department, the search, «Group by» with subtotals, the
 * lines table (cards on a phone) with the ⋯ menu per line and the bulk bar of the ticked lines (Merge, Change
 * quarter, Clear). Submitting for approval is WP-LD-03. Everything the server figured comes from the query;
 * read-only for a viewer who may not change the plan or a line.
 */
export function PlanTab(props: PlanTabProps) {
  const { view, locale } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const model = useMemo(() => planModel(locale, view, texts), [locale, view, texts]);
  const router = useRouter();
  const [subview, setSubview] = useState<PlanSubview>(props.initialSubview);
  const [grouping, setGrouping] = useState<PlanGrouping>(props.initialGrouping);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialogState] = useState<Dialogs>(null);
  const [pending, startTransition] = useTransition();
  // A popup is mounted only while open: on closing, focus goes back to what opened it — the row's ⋯ button
  // when it was opened from that menu (the menu item itself is gone by then).
  const opener = useRef<HTMLElement | null>(null);
  const setDialog = (next: Dialogs) => {
    if (next !== null && dialog === null) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      opener.current = active?.closest('[role="menu"]')
        ? document.querySelector<HTMLElement>('[aria-haspopup="menu"][data-state="open"]')
        : active;
    }
    setDialogState(next);
    if (next === null) {
      const back = opener.current;
      opener.current = null;
      window.requestAnimationFrame(() => {
        if (back?.isConnected) back.focus();
      });
    }
  };

  const byId = useMemo(() => new Map(view.lines.map((l) => [l.id, l])), [view.lines]);
  // Ticked lines that are gone or no longer editable after a reload drop out of the selection.
  const ticked = [...selected].flatMap((id) => {
    const line = byId.get(id);
    return line && model.editable(line) ? [line] : [];
  });
  const groups = visibleGroups(view, grouping, (line) =>
    lineMatches(line, search, model.departmentName),
  );
  const shownLines = groups.flatMap((g) => g.lines);
  const selectable = shownLines.filter((l) => model.editable(l));
  const allTicked = selectable.length > 0 && selectable.every((l) => selected.has(l.id));
  const someTicked = selectable.some((l) => selected.has(l.id));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showView = (next: PlanSubview) => {
    setSubview(next);
    rememberInAddress(router, { view: next === 'budget' ? 'budget' : null });
  };

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof texts.message>[0] }>,
    done: string,
  ) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(done);
        router.refresh();
        return;
      }
      if (texts.sessionRefused(result.error)) return;
      toast.error(texts.actionMessage(result.error));
    });
  };

  const bringBack = (line: PlanLine) => {
    setDialog(null);
    run(
      () => bringBackPlanLineAction({ lineId: line.id, version: line.version }),
      t('line.broughtBack', { title: line.title }),
    );
  };

  const groupLabel = (key: string | null): string => {
    if (key === null) return t(`groups.none.${grouping}`);
    switch (grouping) {
      case 'quarter':
        return model.quarter(Number(key));
      case 'delivery_type':
        return t(`deliveryTypes.${key}`);
      case 'branch': {
        const branch = view.branches.find((b) => b.id === key);
        if (!branch) return '—';
        return locale === 'ar' ? branch.name.ar : (branch.name.en ?? branch.name.ar);
      }
      case 'topic':
        return view.categories.find((c) => c.value === key)?.label[locale] ?? key;
    }
  };

  const overCount = view.budget.departments.filter((d) => d.state.kind === 'over').length;
  const uncosted = view.attention.uncostedLineIds.flatMap((id) => byId.get(id) ?? []);
  const belowMinimum = view.attention.belowMinimumLineIds.flatMap((id) => byId.get(id) ?? []);
  const lookAlikes = view.attention.lookAlikes.flatMap(([a, b]) => {
    const one = byId.get(a);
    const two = byId.get(b);
    return one && two && model.editable(one) && model.editable(two) ? [[one, two] as const] : [];
  });
  const pendingChanges = view.attention.pending.needs + view.attention.pending.changed;
  const departmentsWithPeople = view.budget.departments.filter((d) => d.people > 0).length;

  const attention: ReactNode[] = [];
  const firstUncosted = uncosted[0];
  if (firstUncosted) {
    attention.push(
      <AttentionItem
        key="uncosted"
        icon="warning"
        data-testid="plan-attention-uncosted"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDialog({ kind: 'line', line: firstUncosted });
            }}
          >
            {t('attention.addCost')}
          </Button>
        }
      >
        {uncosted.length === 1
          ? t('attention.uncostedOne', { title: firstUncosted.title })
          : t('attention.uncosted', { count: uncosted.length })}
      </AttentionItem>,
    );
  }
  const firstPair = lookAlikes[0];
  if (firstPair) {
    const [one, two] = firstPair;
    const sessionsNow = (one.sessions?.sessions ?? 0) + (two.sessions?.sessions ?? 0);
    attention.push(
      <AttentionItem
        key="lookAlikes"
        icon="collapse-all"
        tone="info"
        data-testid="plan-attention-look-alike"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDialog({ kind: 'merge', lines: [one, two] });
            }}
          >
            {t('attention.reviewMerge')}
          </Button>
        }
      >
        {t('attention.lookAlike', { one: one.title, two: two.title })}
        {sessionsNow > 0 ? ` ${t('attention.lookAlikeSessions', { count: sessionsNow })}` : ''}
        {lookAlikes.length > 1
          ? ` ${t('attention.morePairs', { count: lookAlikes.length - 1 })}`
          : ''}
      </AttentionItem>,
    );
  }
  if (view.attention.overBudgetWithoutReason.length > 0) {
    attention.push(
      <AttentionItem
        key="budget"
        icon="wallet"
        data-testid="plan-attention-budget"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              showView('budget');
            }}
          >
            {t('attention.openBudget')}
          </Button>
        }
      >
        {t('attention.overBudget', {
          count: overCount,
          without: view.attention.overBudgetWithoutReason.length,
        })}
      </AttentionItem>,
    );
  }
  const firstBelow = belowMinimum[0];
  if (firstBelow) {
    attention.push(
      <AttentionItem
        key="belowMinimum"
        icon="people"
        tone="info"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDialog({ kind: 'line', line: firstBelow });
            }}
          >
            {t('attention.open')}
          </Button>
        }
      >
        {belowMinimum.length === 1
          ? t('attention.belowMinimumOne', { title: firstBelow.title })
          : t('attention.belowMinimum', { count: belowMinimum.length })}
      </AttentionItem>,
    );
  }
  if (pendingChanges > 0) {
    attention.push(
      <AttentionItem
        key="pending"
        icon="sync"
        tone="info"
        data-testid="plan-attention-pending"
        action={
          view.can.addPending && view.plan ? (
            <Button
              variant="secondary"
              size="sm"
              busy={pending}
              disabled={pending}
              onClick={() => {
                const planId = view.plan?.id;
                if (!planId) return;
                run(() => syncPlanNeedsAction({ planId }), t('attention.added'));
              }}
              data-testid="plan-add-pending"
            >
              {t('attention.addThem')}
            </Button>
          ) : null
        }
      >
        {t('attention.pending', {
          count: pendingChanges,
          departments: view.attention.pending.departmentIds
            .map((id) => model.departmentName(id))
            .join(t('listSeparator')),
        })}
      </AttentionItem>,
    );
  }

  const menu = (line: PlanLine) => {
    const editable = model.editable(line);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={t('lines.menu', { title: line.title })}
          data-testid="plan-line-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => {
              setDialog({ kind: 'line', line });
            }}
            data-testid="plan-line-open"
          >
            <Icon name="eye" />
            {t('lines.open')}
          </DropdownMenuItem>
          {editable ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setDialog({ kind: 'quarter', lines: [line] });
                }}
                data-testid="plan-line-move-quarter"
              >
                <Icon name="calendar" />
                {t('lines.moveQuarter')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {line.status === 'in_plan' ? (
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => {
                    setDialog({ kind: 'leaveOut', line });
                  }}
                  data-testid="plan-line-menu-leave-out"
                >
                  <Icon name="ban" />
                  {t('line.leaveOut')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={pending}
                  onSelect={() => {
                    bringBack(line);
                  }}
                  data-testid="plan-line-menu-bring-back"
                >
                  <Icon name="undo" />
                  {t('line.bringBack')}
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const checkbox = (line: PlanLine) =>
    model.editable(line) ? (
      <input
        type="checkbox"
        checked={selected.has(line.id)}
        onChange={() => {
          toggle(line.id);
        }}
        aria-label={t('lines.select', { title: line.title })}
        className="size-5 accent-primary pointer-coarse:size-6"
        data-testid="plan-line-select"
      />
    ) : null;

  const trainingCell = (line: PlanLine) => {
    const leftOut = line.status === 'left_out';
    const detail = [
      model.deliveryLabel(line.deliveryType),
      line.courseId ? t('lines.fromLibrary') : t('lines.needs', { count: line.needs.length }),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <span className="flex min-w-0 flex-col">
        <button
          type="button"
          onClick={() => {
            setDialog({ kind: 'line', line });
          }}
          className={cn(
            'w-fit rounded-sm text-start font-semibold text-text hover:underline',
            leftOut && 'text-text-muted line-through',
          )}
          data-testid="plan-line-title"
        >
          {line.title}
        </button>
        {leftOut && line.leftOutReason ? (
          <span className="text-sm text-text-muted">«{line.leftOutReason}»</span>
        ) : (
          <span className="text-sm text-text-muted">{detail}</span>
        )}
      </span>
    );
  };

  const departmentsCell = (line: PlanLine) => {
    const names = line.departments.map((d) => model.departmentName(d.departmentId));
    const shown = names.slice(0, 2);
    return (
      <span className="flex flex-wrap gap-1">
        {shown.map((name) => (
          <span key={name} className="rounded-md bg-surface-hover px-2 py-0.5 text-[13px]">
            {name}
          </span>
        ))}
        {names.length > 2 ? (
          <span
            className="rounded-md border border-border px-1.5 py-0.5 text-[13px]"
            title={names.slice(2).join(t('listSeparator'))}
          >
            {t('lines.moreDepartments', { count: names.length - 2 })}
            <span className="sr-only">: {names.slice(2).join(t('listSeparator'))}</span>
          </span>
        ) : null}
      </span>
    );
  };

  const peopleCell = (line: PlanLine) => (
    <span className="flex flex-col items-end">
      <span>{model.number(line.people)}</span>
      <span className="text-sm text-text-muted">
        {line.named > 0 ? t('lines.named', { count: line.named }) : t('lines.namesLater')}
      </span>
    </span>
  );

  const sessionsCell = (line: PlanLine) =>
    line.status === 'left_out' || line.sessions === null ? (
      <span className="text-text-muted">—</span>
    ) : (
      <span className="flex flex-col items-end">
        <span>{model.number(line.sessions.sessions)}</span>
        <span className="text-sm text-text-muted">
          {line.sessions.sizes.map((n) => model.number(n)).join(' · ')}
        </span>
      </span>
    );

  const costCell = (line: PlanLine) =>
    line.status === 'left_out' || line.cost === null ? (
      <span className="text-text-muted">—</span>
    ) : (
      <span className="flex flex-col items-end">
        <span>{model.amount(line.cost)}</span>
        {line.costPerSession !== null ? (
          <span className="text-sm text-text-muted">
            {t('lines.perSession', { amount: model.amount(line.costPerSession) })}
          </span>
        ) : null}
      </span>
    );

  const summary = view.summary;
  const groupingLabel = t(`groups.by.${grouping}`);

  return (
    <div className="flex flex-col gap-6" data-testid="plan-tab">
      <StatGrid label={t('summary.label')} data-testid="plan-summary">
        <StatCard
          variant="gradient"
          icon="plan"
          label={t('summary.lines')}
          value={model.number(summary.lines + summary.leftOut)}
          hint={t('summary.linesHint', { inPlan: summary.lines, leftOut: summary.leftOut })}
        />
        <StatCard
          variant="gradient"
          icon="people"
          label={t('summary.people')}
          value={model.number(summary.people)}
          hint={t('summary.peopleHint', { count: departmentsWithPeople })}
        />
        <StatCard
          variant="gradient"
          icon="sessions"
          label={t('summary.sessions')}
          value={model.number(summary.sessions)}
          hint={
            uncosted.length > 0
              ? t('summary.sessionsUncosted', { count: uncosted.length })
              : t('summary.sessionsHint')
          }
        />
        <div
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6 shadow-1"
          data-testid="plan-summary-cost"
        >
          <dt className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <Icon name="wallet" className="size-[18px]" />
            {t('summary.cost')}
          </dt>
          <dd className="m-0 text-2xl font-bold tabular-nums">{model.amount(summary.cost)}</dd>
          <dd className="m-0 text-sm text-text-muted">
            {summary.envelope === null
              ? t('summary.noBudget')
              : t('summary.ofBudget', { amount: model.amount(summary.envelope) })}
          </dd>
          {summary.envelope !== null ? (
            <dd className="m-0">
              <BudgetMeter
                cost={summary.cost}
                envelope={summary.envelope}
                state={view.budget.total.state}
                label={t('summary.cost')}
              />
            </dd>
          ) : null}
          {overCount > 0 ? (
            <dd className="m-0 flex items-start gap-1.5 text-sm font-semibold text-warning">
              <Icon name="warning" className="mt-0.5 size-4 shrink-0" />
              {t('summary.overCount', { count: overCount })}
            </dd>
          ) : null}
        </div>
      </StatGrid>

      {attention.length > 0 ? (
        <AttentionStrip title={t('attention.title')} data-testid="plan-attention">
          {attention}
        </AttentionStrip>
      ) : null}

      <section
        className="overflow-hidden rounded-xl border border-border bg-surface text-text shadow-2"
        aria-label={t('lines.sectionLabel')}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <div
            className="inline-flex items-center gap-1 rounded-full bg-surface-hover p-1"
            role="group"
            aria-label={t('views.label')}
          >
            {(['lines', 'budget'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={subview === key}
                onClick={() => {
                  showView(key);
                }}
                className={cn(
                  'inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium pointer-coarse:min-h-11',
                  subview === key
                    ? 'bg-surface text-text shadow-1'
                    : 'text-text-muted hover:bg-surface hover:text-text',
                )}
                data-testid={`plan-view-${key}`}
              >
                <Icon name={key === 'lines' ? 'plan' : 'wallet'} className="size-4" />
                {t(`views.${key}`)}
                <span className="rounded-full bg-primary-subtle px-1.5 text-xs font-semibold text-primary-text tabular-nums">
                  {model.number(
                    key === 'lines' ? view.lines.length : view.budget.departments.length,
                  )}
                </span>
              </button>
            ))}
          </div>
          {subview === 'lines' ? (
            <>
              <ListSearch
                id="plan-search"
                label={t('lines.search')}
                placeholder={t('lines.search')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              <div className="flex items-center gap-2 md:ms-auto">
                <span className="hidden text-sm text-text-muted lg:inline" id="plan-group-label">
                  {t('groups.label')}
                </span>
                <div
                  className="hidden items-center gap-1 rounded-full bg-surface-hover p-1 lg:inline-flex"
                  role="group"
                  aria-labelledby="plan-group-label"
                >
                  {PLAN_GROUPINGS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={grouping === key}
                      onClick={() => {
                        setGrouping(key);
                        rememberInAddress(router, { group: key === 'topic' ? null : key });
                      }}
                      className={cn(
                        'min-h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-medium',
                        grouping === key
                          ? 'bg-surface text-text shadow-1'
                          : 'text-text-muted hover:bg-surface hover:text-text',
                      )}
                      data-testid={`plan-group-${key}`}
                    >
                      {t(`groups.by.${key}`)}
                    </button>
                  ))}
                </div>
                <div className="lg:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] border-border-strong px-3.5 text-sm font-medium pointer-coarse:min-h-11"
                      data-testid="plan-group-menu"
                    >
                      {t('groups.pill', { grouping: groupingLabel })}
                      <Icon name="chevron-down" className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuRadioGroup
                        value={grouping}
                        onValueChange={(value) => {
                          const next = value as PlanGrouping;
                          setGrouping(next);
                          rememberInAddress(router, { group: next === 'topic' ? null : next });
                        }}
                      >
                        {PLAN_GROUPINGS.map((key) => (
                          <DropdownMenuRadioItem key={key} value={key}>
                            {t(`groups.by.${key}`)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {subview === 'budget' ? (
          <BudgetView model={model} />
        ) : (
          <>
            {ticked.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-3 border-b border-border bg-primary-subtle px-5 py-3"
                role="region"
                aria-label={t('bulk.label')}
                data-testid="plan-bulk-bar"
              >
                <p className="m-0 text-[15px]" aria-live="polite">
                  <b>{t('bulk.selected', { count: ticked.length })}</b>
                  <span className="text-text-muted">
                    {' · '}
                    {t('bulk.people', { count: ticked.reduce((n, l) => n + l.people, 0) })}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
                  {ticked.length >= 2 ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setDialog({ kind: 'merge', lines: ticked });
                      }}
                      data-testid="plan-bulk-merge"
                    >
                      <Icon name="collapse-all" className="size-4" />
                      {t('bulk.merge')}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog({ kind: 'quarter', lines: ticked });
                    }}
                    data-testid="plan-bulk-quarter"
                  >
                    <Icon name="calendar" className="size-4" />
                    {t('bulk.changeQuarter')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelected(new Set());
                    }}
                    data-testid="plan-bulk-clear"
                  >
                    {t('bulk.clear')}
                  </Button>
                </div>
              </div>
            ) : null}

            {view.lines.length === 0 ? (
              <EmptyState
                icon="plan"
                title={t('lines.emptyTitle')}
                description={t('lines.emptyBody')}
              />
            ) : groups.length === 0 ? (
              <EmptyState
                icon="search"
                title={t('lines.noMatchTitle')}
                description={t('lines.noMatchBody')}
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <div
                    className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
                    tabIndex={0}
                    role="region"
                    aria-label={t('lines.caption')}
                  >
                    <table className={tableClasses.table} data-testid="plan-lines-table">
                      <caption className="sr-only">
                        {t('lines.captionGrouped', { grouping: groupingLabel })}
                      </caption>
                      <thead className={tableClasses.header}>
                        <tr>
                          <th scope="col" className={cn(tableClasses.head, 'w-12')}>
                            {selectable.length > 0 ? (
                              <input
                                type="checkbox"
                                checked={allTicked}
                                ref={(element) => {
                                  if (element) element.indeterminate = someTicked && !allTicked;
                                }}
                                onChange={() => {
                                  setSelected(
                                    allTicked ? new Set() : new Set(selectable.map((l) => l.id)),
                                  );
                                }}
                                aria-label={t('lines.selectAll')}
                                className="size-5 accent-primary"
                                data-testid="plan-select-all"
                              />
                            ) : (
                              <span className="sr-only">{t('lines.columns.select')}</span>
                            )}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('lines.columns.training')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('lines.columns.departments')}
                          </th>
                          <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                            {t('lines.columns.people')}
                          </th>
                          <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                            {t('lines.columns.sessions')}
                          </th>
                          <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                            {t('lines.columns.cost')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('lines.columns.when')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('lines.columns.status')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            <span className="sr-only">{t('lines.columns.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      {groups.map(({ key, group, lines }) => {
                        const groupId = `${grouping}:${key ?? ''}`;
                        const open = !collapsed.has(groupId);
                        const label = groupLabel(key);
                        return (
                          <tbody key={groupId} data-testid="plan-group">
                            <tr className="border-b border-border bg-surface-sunken">
                              <td className={tableClasses.cell} />
                              <th
                                scope="colgroup"
                                colSpan={2}
                                className={cn(tableClasses.cell, 'text-start')}
                              >
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  onClick={() => {
                                    setCollapsed((current) => {
                                      const next = new Set(current);
                                      if (next.has(groupId)) next.delete(groupId);
                                      else next.add(groupId);
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-sm font-semibold"
                                  data-testid="plan-group-toggle"
                                >
                                  <Icon
                                    name={open ? 'chevron-down' : 'chevron-end'}
                                    className="size-4"
                                  />
                                  {label}
                                  <span className="font-normal text-text-muted">
                                    · {t('groups.lines', { count: group.lineIds.length })}
                                  </span>
                                </button>
                              </th>
                              <td
                                className={cn(
                                  tableClasses.cell,
                                  'text-end font-semibold tabular-nums',
                                )}
                              >
                                {model.number(group.people)}
                              </td>
                              <td
                                className={cn(
                                  tableClasses.cell,
                                  'text-end font-semibold tabular-nums',
                                )}
                              >
                                {model.number(group.sessions)}
                              </td>
                              <td
                                className={cn(
                                  tableClasses.cell,
                                  'text-end font-semibold tabular-nums',
                                )}
                              >
                                {model.amount(group.cost)}
                              </td>
                              <td className={tableClasses.cell} colSpan={3} />
                            </tr>
                            {open
                              ? lines.map((line) => (
                                  <tr
                                    key={line.id}
                                    className={cn(
                                      tableClasses.row,
                                      selected.has(line.id) && 'bg-surface-selected',
                                    )}
                                    data-testid="plan-line-row"
                                    data-line-id={line.id}
                                  >
                                    <td className={tableClasses.cell}>{checkbox(line)}</td>
                                    <td className={cn(tableClasses.cell, 'min-w-56')}>
                                      {trainingCell(line)}
                                    </td>
                                    <td className={cn(tableClasses.cell, 'min-w-40')}>
                                      {departmentsCell(line)}
                                    </td>
                                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                                      {peopleCell(line)}
                                    </td>
                                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                                      {sessionsCell(line)}
                                    </td>
                                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                                      {costCell(line)}
                                    </td>
                                    <td className={tableClasses.cell}>
                                      <QuarterChip quarter={line.quarter} model={model} />
                                    </td>
                                    <td className={tableClasses.cell}>
                                      <LineStatusBadge line={line} model={model} />
                                    </td>
                                    <td className={cn(tableClasses.cell, 'text-end')}>
                                      {menu(line)}
                                    </td>
                                  </tr>
                                ))
                              : null}
                          </tbody>
                        );
                      })}
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-3 p-4 md:hidden" data-testid="plan-line-cards">
                  {groups.map(({ key, group, lines }, index) => (
                    <details
                      key={`${grouping}:${key ?? ''}`}
                      open={index === 0}
                      className="group/plan-group"
                    >
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon
                            name="chevron-end"
                            className="size-4 transition-transform group-open/plan-group:rotate-90 rtl:group-open/plan-group:-rotate-90"
                          />
                          <b>{groupLabel(key)}</b>
                          <span className="text-text-muted">
                            · {t('groups.lines', { count: group.lineIds.length })}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums">{model.amount(group.cost)}</span>
                      </summary>
                      <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
                        {lines.map((line) => (
                          <li
                            key={line.id}
                            className={cn(
                              'rounded-xl border border-border bg-surface p-4',
                              selected.has(line.id) && 'border-primary bg-surface-selected',
                            )}
                            data-testid="plan-line-card"
                          >
                            <div className="flex items-start gap-3">
                              {checkbox(line)}
                              <div className="min-w-0 flex-1">
                                {trainingCell(line)}
                                <span className="block text-sm text-text-muted">
                                  {line.departments
                                    .map((d) => model.departmentName(d.departmentId))
                                    .join(t('listSeparator'))}
                                </span>
                              </div>
                              {menu(line)}
                            </div>
                            <dl className="m-0 mt-3 grid grid-cols-3 gap-2">
                              <div>
                                <dt className="text-xs font-semibold uppercase text-text-muted">
                                  {t('lines.columns.people')}
                                </dt>
                                <dd className="m-0 font-semibold tabular-nums">
                                  {model.number(line.people)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase text-text-muted">
                                  {t('lines.columns.sessions')}
                                </dt>
                                <dd className="m-0 font-semibold tabular-nums">
                                  {line.sessions === null || line.status === 'left_out'
                                    ? '—'
                                    : model.number(line.sessions.sessions)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase text-text-muted">
                                  {t('lines.columns.cost')}
                                </dt>
                                <dd className="m-0 font-semibold tabular-nums">
                                  {line.cost === null || line.status === 'left_out'
                                    ? '—'
                                    : model.amount(line.cost)}
                                </dd>
                              </div>
                            </dl>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <QuarterChip quarter={line.quarter} model={model} />
                              <LineStatusBadge line={line} model={model} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </>
            )}
            <p className="m-0 flex items-start gap-2.5 border-t border-border px-5.5 py-4 text-sm text-text-muted">
              <Icon name="info" className="mt-0.5 size-4 shrink-0" />
              {t('lines.footnote')}
            </p>
          </>
        )}
      </section>

      {dialog?.kind === 'line' ? (
        <PlanLineDialog
          key={`${dialog.line.id}:${String(dialog.line.version)}`}
          line={dialog.line}
          model={model}
          onClose={() => {
            setDialog(null);
          }}
          onLeaveOut={(line) => {
            setDialog({ kind: 'leaveOut', line });
          }}
          onBringBack={bringBack}
        />
      ) : null}
      {dialog?.kind === 'merge' ? (
        <MergeDialog
          lines={dialog.lines}
          model={model}
          onClose={() => {
            setDialog(null);
          }}
          onMerged={() => {
            setSelected(new Set());
          }}
        />
      ) : null}
      {dialog?.kind === 'leaveOut' ? (
        <LeaveOutDialog
          line={dialog.line}
          model={model}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'quarter' ? (
        <QuarterDialog
          lines={dialog.lines}
          model={model}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
