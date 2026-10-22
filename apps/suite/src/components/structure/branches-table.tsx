'use client';
import {
  Badge,
  type Breadcrumb,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ListCard,
  ListCards,
  PageHeader,
  cn,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { deleteBranchAction, setBranchStatusAction } from '../../actions/branches';
import {
  type BranchFilter,
  branchCounts,
  branchTree,
  deleteBlockers,
  inFilter,
} from '../../lib/branches-view';
import { fillText } from '../../lib/fill-text';
import { branchFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { BranchPanel, type BranchView } from './branch-panel';
import { ConfirmDialog } from './confirm-dialog';
import { failureOf } from './failure';
import type { Choice } from './unit-panel';

export interface BranchesTableProps {
  readonly branches: readonly BranchView[];
  readonly canManage: boolean;
  readonly countries: readonly Choice[];
  readonly timeZones: readonly Choice[];
  readonly defaultTimeZone: string;
  readonly texts: Readonly<Record<string, string>>;
  /** «تراجع» / "Undo" (the toast after deactivating). */
  readonly undoLabel: string;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  /** The page's header (rendered here: «Add branch» opens the side panel of this list). */
  readonly header: {
    readonly title: string;
    readonly description: string;
    readonly breadcrumbs: readonly Breadcrumb[];
    readonly breadcrumbsLabel: string;
  };
  /** The status filter of the address (`?status=`). */
  readonly filter: BranchFilter;
  /** The page's address without the filter (`/en/suite/admin/branches`). */
  readonly path: string;
  /** Shown between the header and the list (e.g. «You can view the branches…»). */
  readonly notice?: ReactNode;
}

type DialogState =
  | { readonly kind: 'form'; readonly branch: BranchView | null }
  | { readonly kind: 'delete'; readonly branch: BranchView };

/**
 * Organization → Branches (FR-ADM-04 core fields), direction C (redesign package 2, PO 21 Oct 2026):
 * All / Active / Inactive pills with their counts, the headquarters first with its badge, sub-branches
 * indented under their parent, the code under the name, one card per branch on phones. «Add branch» and
 * Edit open a side panel with the list in view (Q2-8); the saved row is highlighted. Deactivate acts at
 * once with «Undo» in the toast (Q2-9 — fully reversible); Activate is one click. Delete shows, in the
 * menu, what still belongs to the branch; with nothing left, the red confirmation asks first.
 */
export function BranchesTable(props: BranchesTableProps) {
  const { branches, canManage, texts, locale, filter } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const close = () => {
    setDialog(null);
  };

  const counts = branchCounts(branches);
  const rows = branchTree(branches.filter((branch) => inFilter(branch, filter)));
  const headquarters = branches.find((branch) => branch.isHeadquarters) ?? null;

  function refusal(error: Parameters<typeof sessionRefused>[0]): string | null {
    if (sessionRefused(error)) return null;
    const failure = failureOf(error, text, props.errors, branchFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  async function run(
    action: () => ReturnType<typeof deleteBranchAction>,
    done: string,
  ): Promise<string | null> {
    const result = await action();
    if (result.ok) {
      toast.success(done);
      router.refresh();
      return null;
    }
    return refusal(result.error);
  }

  /** Activate (one click), or deactivate with «Undo» in the toast (it is fully reversible, Q2-9). */
  async function setStatus(branch: BranchView, active: boolean) {
    const result = await setBranchStatusAction({
      id: branch.id,
      version: branch.version,
      status: active ? 'active' : 'inactive',
    });
    if (!result.ok) {
      const message = refusal(result.error);
      if (message) toast.error(message);
      return;
    }
    router.refresh();
    if (active) {
      toast.success(fill('toasts.activated', { name: branch.name }));
      return;
    }
    const after = result.value.after;
    toast.success(
      fill('toasts.deactivated', { name: branch.name }),
      after
        ? {
            action: {
              label: props.undoLabel,
              onClick: () => {
                void setStatus({ ...branch, version: after.version, active: false }, true);
              },
            },
          }
        : undefined,
    );
  }

  const statusBadge = (branch: BranchView) => (
    <Badge tone={branch.active ? 'success' : 'warning'} dot>
      {branch.active ? text('active') : text('inactive')}
    </Badge>
  );

  const menu = (branch: BranchView) => {
    const blockers = deleteBlockers(branch);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={fill('actionsFor', { name: branch.name })}
          data-testid="branch-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-80">
          <DropdownMenuItem
            onSelect={() => {
              setDialog({ kind: 'form', branch });
            }}
          >
            <Icon name="pencil" />
            {text('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void setStatus(branch, !branch.active);
            }}
            data-testid="branch-status"
          >
            <Icon name={branch.active ? 'ban' : 'check'} />
            {branch.active ? text('deactivate') : text('activate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Blocked: still reachable (the reason is read with it, and the dialog lists it again). */}
          <DropdownMenuItem
            tone={blockers.length > 0 ? 'default' : 'danger'}
            aria-disabled={blockers.length > 0 || undefined}
            className={cn(blockers.length > 0 && 'items-start text-text-muted')}
            onSelect={() => {
              setDialog({ kind: 'delete', branch });
            }}
            data-testid="branch-delete"
          >
            <Icon name="trash" className={cn(blockers.length > 0 && 'mt-0.5')} />
            <span className="flex flex-col gap-0.5">
              <span>{text('delete')}</span>
              {blockers.length > 0 ? (
                <span className="text-[13px] text-text-muted" data-testid="branch-delete-reason">
                  {blockers.map((item) => fill(item.key, { count: item.count })).join(' · ')}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const tile = (branch: BranchView) => (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9.5 shrink-0 place-items-center rounded-md',
        branch.isHeadquarters
          ? 'bg-brand-gradient text-on-brand'
          : 'bg-primary-subtle text-primary-text',
      )}
    >
      <Icon name="building" />
    </span>
  );

  const filters: readonly BranchFilter[] = ['all', 'active', 'inactive'];
  const filterLabel = (key: BranchFilter) =>
    key === 'all' ? text('filterAll') : key === 'active' ? text('active') : text('inactive');

  return (
    <>
      <PageHeader
        title={props.header.title}
        description={props.header.description}
        breadcrumbs={props.header.breadcrumbs}
        breadcrumbsLabel={props.header.breadcrumbsLabel}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'form', branch: null });
              }}
              className="w-full md:w-auto"
              data-testid="branch-add"
            >
              <Icon name="plus" />
              {text('add')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-6">
        {props.notice}
        <section
          aria-labelledby="branches-card-title"
          className="overflow-hidden rounded-xl border border-border bg-surface"
          data-testid="branches-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5.5 pb-4 pt-5">
            <div className="min-w-0">
              <h2 id="branches-card-title" className="m-0 text-lg font-bold">
                {text('cardTitle')}
              </h2>
              <p className="m-0 text-sm text-text-muted">{text('cardDescription')}</p>
            </div>
            {branches.length > 0 ? (
              <nav aria-label={text('filterLabel')} data-testid="branch-filters">
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {filters.map((key) => (
                    <li key={key}>
                      <a
                        href={key === 'all' ? props.path : `${props.path}?status=${key}`}
                        aria-current={filter === key ? 'page' : undefined}
                        className={cn(
                          'inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] px-4 text-[14.5px] font-semibold no-underline pointer-coarse:min-h-11',
                          filter === key
                            ? 'border-transparent bg-brand-gradient text-on-brand'
                            : 'border-border-strong text-text hover:bg-surface-hover',
                        )}
                        data-testid={`branch-filter-${key}`}
                      >
                        {filterLabel(key)}
                        <span className="tabular-nums">{counts[key]}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
          {branches.length === 0 ? (
            <EmptyState
              icon="building"
              headingLevel={3}
              title={text('empty')}
              description={text('emptyBody')}
              action={
                canManage ? (
                  <Button
                    onClick={() => {
                      setDialog({ kind: 'form', branch: null });
                    }}
                  >
                    <Icon name="plus" />
                    {text('add')}
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <div
                className={`${tableClasses.wrapper} hidden focus-visible:outline-2 focus-visible:outline-offset-2 md:block`}
                // Scrolls on narrow screens: focusable so the keyboard can scroll it too (WCAG 2.1.1;
                // axe scrollable-region-focusable — a view-only table has nothing focusable).
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
                tabIndex={0}
                role="region"
                aria-label={text('caption')}
              >
                <table className={tableClasses.table} data-testid="branches-table">
                  <caption className="sr-only">{text('caption')}</caption>
                  <thead className={tableClasses.header}>
                    <tr>
                      {(['name', 'location', 'timezone', 'units', 'people', 'status'] as const).map(
                        (column) => (
                          <th
                            key={column}
                            scope="col"
                            className={cn(
                              tableClasses.head,
                              (column === 'units' || column === 'people') && 'text-end',
                            )}
                          >
                            {text(`columns.${column}`)}
                          </th>
                        ),
                      )}
                      {canManage ? (
                        <th scope="col" className={tableClasses.head}>
                          <span className="sr-only">{text('columns.actions')}</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ branch, depth }) => (
                      <tr
                        key={branch.id}
                        className={cn(
                          tableClasses.row,
                          highlight === branch.id && 'bg-primary-subtle',
                        )}
                        data-testid={`branch-row-${branch.code}`}
                        data-highlighted={highlight === branch.id || undefined}
                      >
                        <td className={tableClasses.cell}>
                          <div
                            className={cn(
                              'flex items-center gap-3',
                              depth === 1 && 'ps-7',
                              depth >= 2 && 'ps-14',
                            )}
                          >
                            {tile(branch)}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{branch.name}</span>
                                {branch.isHeadquarters ? (
                                  <Badge tone="brand">{text('headquarters')}</Badge>
                                ) : null}
                              </div>
                              <span dir="ltr" className="font-mono text-xs text-text-muted">
                                {branch.code}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className={tableClasses.cell}>{branch.location ?? '—'}</td>
                        <td className={tableClasses.cell}>{branch.timezoneLabel}</td>
                        <td className={`${tableClasses.cell} text-end tabular-nums`}>
                          {branch.unitCount}
                        </td>
                        <td className={`${tableClasses.cell} text-end tabular-nums`}>
                          {branch.peopleCount}
                        </td>
                        <td className={tableClasses.cell}>{statusBadge(branch)}</td>
                        {canManage ? (
                          <td className={`${tableClasses.cell} text-end`}>{menu(branch)}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListCards className="border-t border-border" data-testid="branches-cards">
                {rows.map(({ branch, depth }) => (
                  <ListCard
                    key={branch.id}
                    className={cn(
                      depth === 1 && 'ps-8',
                      depth >= 2 && 'ps-12',
                      highlight === branch.id && 'bg-primary-subtle',
                    )}
                    leading={tile(branch)}
                    title={branch.name}
                    detail={
                      <>
                        {branch.location ? `${branch.location} · ` : null}
                        <span dir="ltr">{branch.code}</span>
                      </>
                    }
                    status={
                      <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
                        {branch.isHeadquarters ? (
                          <Badge tone="brand">{text('headquarters')}</Badge>
                        ) : null}
                        {statusBadge(branch)}
                        <span>
                          {text('columns.units')}: {branch.unitCount} · {text('columns.people')}:{' '}
                          {branch.peopleCount}
                        </span>
                      </span>
                    }
                    action={canManage ? menu(branch) : undefined}
                  />
                ))}
              </ListCards>
            </>
          )}
        </section>
      </div>

      {dialog?.kind === 'form' ? (
        <BranchPanel
          branch={dialog.branch}
          parents={branches
            .filter((b) => b.id !== dialog.branch?.id)
            .map((b) => ({ value: b.id, label: b.name }))}
          countries={props.countries}
          timeZones={props.timeZones}
          defaultTimeZone={props.defaultTimeZone}
          headquartersName={
            headquarters && headquarters.id !== dialog.branch?.id ? headquarters.name : null
          }
          texts={texts}
          errors={props.errors}
          locale={locale}
          onClose={close}
          onSaved={setHighlight}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteBranchDialog
          branch={dialog.branch}
          text={text}
          fill={fill}
          onClose={close}
          onConfirm={() =>
            run(
              () => deleteBranchAction({ id: dialog.branch.id, version: dialog.branch.version }),
              fill('toasts.deleted', { name: dialog.branch.name }),
            )
          }
        />
      ) : null}
    </>
  );
}

function DeleteBranchDialog({
  branch,
  text,
  fill,
  onClose,
  onConfirm,
}: {
  readonly branch: BranchView;
  readonly text: (key: string) => string;
  readonly fill: (key: string, values: Record<string, string | number>) => string;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<string | null>;
}) {
  const left = deleteBlockers(branch);
  return (
    <ConfirmDialog
      title={fill('remove.title', { name: branch.name })}
      description={text('remove.text')}
      confirmLabel={text('remove.confirm')}
      workingLabel={text('remove.deleting')}
      keepLabel={text('remove.keep')}
      closeLabel={text('form.close')}
      danger
      canConfirm={left.length === 0}
      onClose={onClose}
      onConfirm={onConfirm}
      data-testid="branch-delete-dialog"
    >
      {left.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="branch-in-use">
          <p className="m-0 text-sm font-medium">{text('remove.inUseTitle')}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-sm">
            {left.map((item) => (
              <li key={item.key}>{fill(item.key, { count: item.count })}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
