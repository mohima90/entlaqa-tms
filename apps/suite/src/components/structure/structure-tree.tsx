'use client';
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { deleteStructureUnitAction, setStructureUnitStatusAction } from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { unitFieldText } from '../../lib/structure-form';
import { parentIds } from '../../lib/structure-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ConfirmDialog } from './confirm-dialog';
import { failureOf } from './failure';
import { type Choice, UnitDialog, type UnitDialogMode, type UnitView } from './unit-dialog';

export interface StructureTreeProps {
  readonly units: readonly UnitView[];
  /** `platform.org.manage`: the add button, the row menus and their dialogs. */
  readonly canManage: boolean;
  /** The organization's first level («Add <first level>» at the top), or null without levels. */
  readonly firstLevelName: string | null;
  readonly branches: readonly Choice[];
  readonly people: readonly Choice[];
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
}

type DialogState =
  | { readonly kind: 'unit'; readonly mode: UnitDialogMode }
  | { readonly kind: 'status'; readonly unit: UnitView }
  | { readonly kind: 'delete'; readonly unit: UnitView };

/**
 * The structure tree in the Kawadir Departments layout (FR-ADM-05, EP-ORG): units under their parent,
 * expanded by default, each row with its level, head and the number of units under it; «Add <first level>»
 * on top and, in each row's menu, «Add <next level>» (none at the last level), edit, deactivate / activate
 * and delete (refused while units, active people or role scopes point at it — the dialog lists them).
 * Nested lists with disclosure buttons (aria-expanded) carry the hierarchy for assistive technology.
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

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    if (sessionRefused(result.error)) return null;
    const failure = failureOf(result.error, text, props.errors, unitFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  const renderUnits = (parentId: string | null, depth: number, listId?: string): ReactNode => (
    <ul
      id={listId}
      className={depth === 0 ? 'm-0 list-none p-0' : 'm-0 list-none p-0 ps-6 sm:ps-8'}
    >
      {(children.get(parentId) ?? []).map((unit) => {
        const own = children.get(unit.id) ?? [];
        const open = expanded.has(unit.id);
        const childListId = `unit-children-${unit.id}`;
        return (
          <li key={unit.id} data-testid={`unit-${unit.code}`}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-3 hover:bg-surface-hover sm:gap-3 sm:px-4">
              {own.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={childListId}
                  aria-label={fill(open ? 'collapse' : 'expand', { name: unit.name })}
                  onClick={() => {
                    toggle(unit.id);
                  }}
                  className="grid size-9 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                  data-testid="unit-toggle"
                >
                  <Icon name={open ? 'chevron-down' : 'chevron-end'} />
                </button>
              ) : (
                <span className="size-9 shrink-0 pointer-coarse:size-11" aria-hidden="true" />
              )}
              <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text sm:grid">
                <Icon name="structure" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={unit.active ? 'font-medium' : 'font-medium text-text-muted'}
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
                <p className="m-0 text-xs text-text-muted">
                  <span dir="ltr">{unit.code}</span>
                  {' · '}
                  {unit.headName ? fill('head', { name: unit.headName }) : text('noHead')}
                  {unit.childCountLabel ? ` · ${unit.childCountLabel}` : ''}
                </p>
              </div>
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="grid size-9 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                    aria-label={fill('actionsFor', { name: unit.name })}
                    data-testid="unit-menu"
                  >
                    <Icon name="more" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {unit.nextLevelName ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setExpanded((current) => new Set(current).add(unit.id));
                          setDialog({
                            kind: 'unit',
                            mode: {
                              kind: 'create',
                              parent: unit,
                              levelName: unit.nextLevelName ?? '',
                            },
                          });
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
                        setDialog({ kind: 'status', unit });
                      }}
                      data-testid="unit-menu-status"
                    >
                      <Icon name={unit.active ? 'lock' : 'check'} />
                      {unit.active ? text('deactivate') : text('activate')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      tone="danger"
                      onSelect={() => {
                        setDialog({ kind: 'delete', unit });
                      }}
                      data-testid="unit-menu-delete"
                    >
                      <Icon name="trash" />
                      {text('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {own.length > 0 && open ? renderUnits(unit.id, depth + 1, childListId) : null}
          </li>
        );
      })}
    </ul>
  );

  const addTop =
    canManage && props.firstLevelName ? (
      <Button
        onClick={() => {
          setDialog({
            kind: 'unit',
            mode: { kind: 'create', parent: null, levelName: props.firstLevelName ?? '' },
          });
        }}
        data-testid="unit-add-top"
      >
        <Icon name="plus" />
        {fill('add', { level: props.firstLevelName })}
      </Button>
    ) : null;

  const closeDialog = () => {
    setDialog(null);
  };

  return (
    <>
      <Card
        flush
        icon="structure"
        title={text('tree.title')}
        description={text('tree.description')}
        actions={addTop}
        data-testid="structure-tree"
      >
        {units.length === 0 ? (
          <EmptyState
            icon="structure"
            headingLevel={3}
            title={text('tree.empty')}
            description={canManage ? text('tree.emptyBody') : text('tree.emptyViewOnly')}
          />
        ) : (
          renderUnits(null, 0)
        )}
      </Card>

      {dialog?.kind === 'unit' ? (
        <UnitDialog
          mode={dialog.mode}
          branches={props.branches}
          people={props.people}
          texts={texts}
          errors={props.errors}
          locale={locale}
          onClose={closeDialog}
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
          keepLabel={text('form.cancel')}
          closeLabel={text('form.close')}
          onClose={closeDialog}
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
          onClose={closeDialog}
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
  const left = [
    { key: 'remove.inUseUnits', count: unit.childCount },
    { key: 'remove.inUsePeople', count: unit.peopleCount },
    { key: 'remove.inUseRoles', count: unit.roleScopeCount },
  ].filter((item) => item.count > 0);
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
