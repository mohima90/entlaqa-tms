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
  PageHeader,
  cn,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { deleteStructureUnitAction, setStructureUnitStatusAction } from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { unitFieldText } from '../../lib/structure-form';
import { deactivatesWithUndo, parentIds, unitDeleteBlockers } from '../../lib/structure-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ConfirmDialog } from './confirm-dialog';
import { failureOf } from './failure';
import { type Choice, type UnitDialogMode, UnitPanel, type UnitView } from './unit-panel';

export interface StructureTreeProps {
  readonly units: readonly UnitView[];
  /** `platform.org.manage`: the add buttons, the row menus, the side panel and its actions. */
  readonly canManage: boolean;
  /** The organization's first level («Add <first level>» at the top), or null without levels. */
  readonly firstLevelName: string | null;
  readonly branches: readonly Choice[];
  readonly people: readonly Choice[];
  readonly texts: Readonly<Record<string, string>>;
  /** «تراجع» / "Undo" (the toast after deactivating a unit no role is limited to). */
  readonly undoLabel: string;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  /** The page's header (rendered here: «Add <first level>» opens this tree's side panel). */
  readonly header: {
    readonly title: string;
    readonly description: string;
    readonly breadcrumbs: readonly Breadcrumb[];
    readonly breadcrumbsLabel: string;
  };
  /** Between the header and the tree: the summary strip, notices and the views (server-rendered). */
  readonly top?: ReactNode;
  /** The address of the levels view (the empty state's first step). */
  readonly levelsHref: string;
}

type DialogState =
  | { readonly kind: 'unit'; readonly mode: UnitDialogMode }
  | { readonly kind: 'status'; readonly unit: UnitView }
  | { readonly kind: 'delete'; readonly unit: UnitView };

/**
 * The structure tree (FR-ADM-05, EP-ORG), direction C (redesign package 2; approved direction,
 * comparison §3): units under their parent with connector lines, expanded by default, «Expand all /
 * Collapse all»; each row with its level, head and the number of units under it, and «+ Add <next level>»
 * on the row (shown on hover or focus; inside ⋯ on phones). Adding or editing opens a side panel with the
 * tree in view; while adding, the parent is highlighted and a dashed placeholder shows where the unit
 * goes. Deactivating a unit no role is limited to acts at once with «Undo» (Q2-9); with limited roles the
 * confirmation stays. Delete shows what still depends on the unit. The tree is a plain nested list of
 * buttons (no ARIA tree): every control is reachable with Tab.
 */
export function StructureTree(props: StructureTreeProps) {
  const { units, canManage, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(parentIds(units)));
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const children = useMemo(() => {
    const ids = new Set(units.map((u) => u.id));
    const map = new Map<string | null, UnitView[]>();
    for (const unit of units) {
      const key = unit.parentId !== null && ids.has(unit.parentId) ? unit.parentId : null;
      map.set(key, [...(map.get(key) ?? []), unit]);
    }
    return map;
  }, [units]);

  // While adding under a unit: that unit is highlighted, a placeholder shows where the new one goes.
  const addingUnder =
    dialog?.kind === 'unit' && dialog.mode.kind === 'create' ? dialog.mode.parent : null;
  const addingLevel =
    dialog?.kind === 'unit' && dialog.mode.kind === 'create' ? dialog.mode.levelName : '';
  const editing = dialog?.kind === 'unit' && dialog.mode.kind === 'edit' ? dialog.mode.unit : null;

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function refusal(error: Parameters<typeof sessionRefused>[0]): string | null {
    if (sessionRefused(error)) return null;
    const failure = failureOf(error, text, props.errors, unitFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  /** Runs a status change or a delete; null when done, else the sentence to show. */
  async function run(
    action: () => ReturnType<typeof deleteStructureUnitAction>,
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

  /** Activate at once; deactivate at once with Undo when no role is limited to the unit (Q2-9). */
  async function setStatusNow(unit: UnitView, active: boolean) {
    const result = await setStructureUnitStatusAction({
      id: unit.id,
      version: unit.version,
      status: active ? 'active' : 'inactive',
    });
    if (!result.ok) {
      const message = refusal(result.error);
      if (message) toast.error(message);
      return;
    }
    router.refresh();
    if (active) {
      toast.success(fill('toasts.activated', { name: unit.name }));
      return;
    }
    const version = result.value.after?.version ?? unit.version + 1;
    toast.success(fill('toasts.deactivated', { name: unit.name }), {
      action: {
        label: props.undoLabel,
        onClick: () => {
          void setStatusNow({ ...unit, version, active: false }, true);
        },
      },
    });
  }

  function changeStatus(unit: UnitView) {
    if (!unit.active || deactivatesWithUndo(unit)) {
      void setStatusNow(unit, !unit.active);
      return;
    }
    // Roles are limited to it: their holders lose access at once — the confirmation stays.
    setDialog({ kind: 'status', unit });
  }

  function addUnder(unit: UnitView) {
    setExpanded((current) => new Set(current).add(unit.id));
    setDialog({
      kind: 'unit',
      mode: { kind: 'create', parent: unit, levelName: unit.nextLevelName ?? '' },
    });
  }

  const addTop = () => {
    setDialog({
      kind: 'unit',
      mode: { kind: 'create', parent: null, levelName: props.firstLevelName ?? '' },
    });
  };

  const menu = (unit: UnitView) => {
    const blockers = unitDeleteBlockers(unit);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={fill('actionsFor', { name: unit.name })}
          data-testid="unit-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-80">
          {unit.nextLevelName ? (
            <DropdownMenuItem
              onSelect={() => {
                addUnder(unit);
              }}
              data-testid="unit-menu-add"
            >
              <Icon name="plus" />
              {fill('add', { level: unit.nextLevelName })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              setDialog({ kind: 'unit', mode: { kind: 'edit', unit } });
            }}
            data-testid="unit-menu-edit"
          >
            <Icon name="pencil" />
            {text('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              changeStatus(unit);
            }}
            data-testid="unit-menu-status"
          >
            <Icon name={unit.active ? 'ban' : 'check'} />
            {unit.active ? text('deactivate') : text('activate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Blocked: still reachable (the reason is read with it, and the dialog lists it again). */}
          <DropdownMenuItem
            tone={blockers.length > 0 ? 'default' : 'danger'}
            aria-disabled={blockers.length > 0 || undefined}
            className={cn(blockers.length > 0 && 'items-start text-text-muted')}
            onSelect={() => {
              setDialog({ kind: 'delete', unit });
            }}
            data-testid="unit-menu-delete"
          >
            <Icon name="trash" className={cn(blockers.length > 0 && 'mt-0.5')} />
            <span className="flex flex-col gap-0.5">
              <span>{text('delete')}</span>
              {blockers.length > 0 ? (
                <span className="text-[13px] text-text-muted" data-testid="unit-delete-reason">
                  {blockers.map((item) => fill(item.key, { count: item.count })).join(' · ')}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderUnits = (parentId: string | null, depth: number, listId?: string): ReactNode => {
    const list = children.get(parentId) ?? [];
    const placeholder =
      addingUnder !== null && addingUnder.id === parentId ? (
        <li aria-hidden="true" data-testid="unit-placeholder">
          <div className="my-1 flex min-h-12 items-center gap-2 rounded-lg border-[1.5px] border-dashed border-primary bg-primary-subtle px-4 font-semibold text-primary-text">
            <Icon name="plus" />
            {fill('add', { level: addingLevel })}
          </div>
        </li>
      ) : null;
    return (
      <ul
        id={listId}
        className={
          depth === 0
            ? 'm-0 flex list-none flex-col gap-0.5 p-0'
            : 'm-0 ms-5 flex list-none flex-col gap-0.5 border-s border-border p-0 ps-3 sm:ms-6.5 sm:ps-4'
        }
      >
        {list.map((unit) => {
          const own = children.get(unit.id) ?? [];
          const open = expanded.has(unit.id) || addingUnder?.id === unit.id;
          const childListId = `unit-children-${unit.id}`;
          const current = addingUnder?.id === unit.id || editing?.id === unit.id;
          return (
            <li key={unit.id} data-testid={`unit-${unit.code}`}>
              <div
                className={cn(
                  'group flex items-center gap-2 rounded-lg border-s-[3px] px-2 py-2.5 sm:gap-3 sm:px-3',
                  current
                    ? 'border-primary bg-primary-subtle'
                    : 'border-transparent hover:bg-surface-hover focus-within:bg-surface-hover',
                )}
                data-current={current || undefined}
              >
                {own.length > 0 ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={childListId}
                    aria-label={fill(open ? 'collapse' : 'expand', { name: unit.name })}
                    onClick={() => {
                      toggle(unit.id);
                    }}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                    data-testid="unit-toggle"
                  >
                    <Icon name={open ? 'chevron-down' : 'chevron-end'} />
                  </button>
                ) : (
                  <span className="size-9 shrink-0 pointer-coarse:size-11" aria-hidden="true" />
                )}
                <span
                  aria-hidden="true"
                  className="hidden size-9 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text sm:grid"
                >
                  <Icon name={depth === 0 ? 'plan' : 'building'} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn('font-semibold', !unit.active && 'text-text-muted')}
                      data-testid="unit-name"
                    >
                      {unit.name}
                    </span>
                    <Badge tone="neutral" data-testid="unit-level">
                      {unit.levelName}
                    </Badge>
                    {unit.active ? null : (
                      <Badge tone="warning" data-testid="unit-inactive">
                        {text('inactive')}
                      </Badge>
                    )}
                  </div>
                  <p className="m-0 text-[13px] text-text-muted">
                    <span dir="ltr">{unit.code}</span>
                    {' · '}
                    {unit.headName ? fill('head', { name: unit.headName }) : text('noHead')}
                    {unit.childCountLabel
                      ? ` · ${unit.childCountLabel}`
                      : unit.nextLevelName === null
                        ? ` · ${text('lastLevelNote')}`
                        : ''}
                  </p>
                </div>
                {canManage && unit.nextLevelName ? (
                  <button
                    type="button"
                    onClick={() => {
                      addUnder(unit);
                    }}
                    className="hidden min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary-text opacity-0 transition-opacity hover:bg-primary-subtle focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none sm:inline-flex"
                    data-testid="unit-add-under"
                  >
                    <Icon name="plus" />
                    {fill('add', { level: unit.nextLevelName })}
                  </button>
                ) : null}
                {canManage ? menu(unit) : null}
              </div>
              {(own.length > 0 && open) || addingUnder?.id === unit.id
                ? renderUnits(unit.id, depth + 1, childListId)
                : null}
            </li>
          );
        })}
        {placeholder}
      </ul>
    );
  };

  const allIds = parentIds(units);

  return (
    <>
      <PageHeader
        title={props.header.title}
        description={props.header.description}
        breadcrumbs={props.header.breadcrumbs}
        breadcrumbsLabel={props.header.breadcrumbsLabel}
        actions={
          canManage && props.firstLevelName ? (
            <Button onClick={addTop} className="w-full sm:w-auto" data-testid="unit-add-top">
              <Icon name="plus" />
              {fill('add', { level: props.firstLevelName })}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">
        {props.top}
        <section
          aria-labelledby="structure-tree-title"
          className="rounded-xl border border-border bg-surface"
          data-testid="structure-tree"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5.5 pb-4 pt-5">
            <div className="min-w-0 flex-[1_1_18rem]">
              <h2 id="structure-tree-title" className="m-0 text-lg font-bold">
                {text('tree.title')}
              </h2>
              <p className="m-0 text-sm text-text-muted">
                {canManage ? text('tree.description') : text('tree.emptyViewOnly')}
              </p>
            </div>
            {allIds.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExpanded(new Set(allIds));
                  }}
                  data-testid="structure-expand-all"
                >
                  <Icon name="expand-all" />
                  {text('expandAll')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExpanded(new Set());
                  }}
                  data-testid="structure-collapse-all"
                >
                  <Icon name="collapse-all" />
                  {text('collapseAll')}
                </Button>
              </div>
            ) : null}
          </div>
          {units.length === 0 ? (
            canManage ? (
              <EmptyState
                icon="structure"
                headingLevel={3}
                title={text('tree.empty')}
                description={text('tree.emptyBody')}
                action={
                  props.firstLevelName ? (
                    <Button onClick={addTop}>
                      <Icon name="plus" />
                      {fill('add', { level: props.firstLevelName })}
                    </Button>
                  ) : null
                }
                steps={[
                  {
                    title: <a href={props.levelsHref}>{text('guide.levels')}</a>,
                    description: text('levels.example'),
                  },
                  { title: text('guide.first'), description: text('tree.emptyBody') },
                ]}
              />
            ) : (
              <EmptyState
                icon="structure"
                headingLevel={3}
                title={text('tree.empty')}
                description={text('tree.emptyViewOnly')}
              />
            )
          ) : (
            <div className="p-2 sm:p-3">{renderUnits(null, 0)}</div>
          )}
        </section>
      </div>

      {dialog?.kind === 'unit' ? (
        <UnitPanel
          mode={dialog.mode}
          branches={props.branches}
          people={props.people}
          texts={texts}
          errors={props.errors}
          locale={locale}
          onClose={() => {
            setDialog(null);
          }}
          onStatus={changeStatus}
          onDelete={(unit) => {
            setDialog({ kind: 'delete', unit });
          }}
        />
      ) : null}

      {dialog?.kind === 'status' ? (
        <ConfirmDialog
          title={fill(dialog.unit.active ? 'status.deactivateTitle' : 'status.activateTitle', {
            name: dialog.unit.name,
          })}
          description={
            dialog.unit.active ? text('status.deactivateText') : text('status.activateText')
          }
          confirmLabel={dialog.unit.active ? text('status.confirmDeactivate') : text('activate')}
          workingLabel={text('status.working')}
          keepLabel={text('status.keep')}
          closeLabel={text('form.close')}
          warning
          onClose={() => {
            setDialog(null);
          }}
          data-testid="unit-status-dialog"
          onConfirm={() =>
            run(
              () =>
                setStructureUnitStatusAction({
                  id: dialog.unit.id,
                  version: dialog.unit.version,
                  status: dialog.unit.active ? 'inactive' : 'active',
                }),
              fill(dialog.unit.active ? 'toasts.deactivated' : 'toasts.activated', {
                name: dialog.unit.name,
              }),
            )
          }
        >
          {dialog.unit.active && dialog.unit.roleScopeCount > 0 ? (
            <p className="m-0 text-sm" data-testid="unit-status-roles">
              {fill('status.deactivateRoles', { count: dialog.unit.roleScopeCount })}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteUnitDialog
          unit={dialog.unit}
          text={text}
          fill={fill}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() =>
            run(
              () => deleteStructureUnitAction({ id: dialog.unit.id, version: dialog.unit.version }),
              fill('toasts.deleted', { name: dialog.unit.name }),
            )
          }
        />
      ) : null}
    </>
  );
}

function DeleteUnitDialog({
  unit,
  text,
  fill,
  onClose,
  onConfirm,
}: {
  readonly unit: UnitView;
  readonly text: (key: string) => string;
  readonly fill: (key: string, values: Record<string, string | number>) => string;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<string | null>;
}) {
  const left = unitDeleteBlockers(unit);
  return (
    <ConfirmDialog
      title={fill('remove.title', { name: unit.name })}
      description={text('remove.text')}
      confirmLabel={text('remove.confirm')}
      workingLabel={text('remove.deleting')}
      keepLabel={text('remove.keep')}
      closeLabel={text('form.close')}
      danger
      canConfirm={left.length === 0}
      onClose={onClose}
      onConfirm={onConfirm}
      data-testid="unit-delete-dialog"
    >
      {left.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="unit-in-use">
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
