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
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteBranchAction, setBranchStatusAction } from '../../actions/branches';
import { fillText } from '../../lib/fill-text';
import { branchFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { BranchDialog, type BranchView } from './branch-dialog';
import { ConfirmDialog } from './confirm-dialog';
import { failureOf } from './failure';
import type { Choice } from './unit-dialog';

export interface BranchesTableProps {
  readonly branches: readonly BranchView[];
  readonly canManage: boolean;
  readonly countries: readonly Choice[];
  readonly timeZones: readonly Choice[];
  readonly defaultTimeZone: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
}

type DialogState =
  | { readonly kind: 'form'; readonly branch: BranchView | null }
  | { readonly kind: 'status'; readonly branch: BranchView }
  | { readonly kind: 'delete'; readonly branch: BranchView };

/**
 * Organization → Branches (FR-ADM-04 core fields; Kawadir list: a table in a card, a dialog for the form):
 * code, names, location, time zone, units and people; «Add branch», and per row edit, deactivate / activate
 * and delete (refused while sub-branches, units or active people still belong to it — the dialog lists them).
 */
export function BranchesTable(props: BranchesTableProps) {
  const { branches, canManage, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => {
    setDialog(null);
  };

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
    if (sessionRefused(result.error)) return null;
    const failure = failureOf(result.error, text, props.errors, branchFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  return (
    <>
      <Card
        flush
        icon="building"
        title={text('cardTitle')}
        description={text('cardDescription')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'form', branch: null });
              }}
              data-testid="branch-add"
            >
              <Icon name="plus" />
              {text('add')}
            </Button>
          ) : null
        }
        data-testid="branches-card"
      >
        {branches.length === 0 ? (
          <EmptyState
            icon="building"
            headingLevel={3}
            title={text('empty')}
            description={text('emptyBody')}
          />
        ) : (
          <div
            className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
            // Scrolls on phones: focusable so the keyboard can scroll it too (WCAG 2.1.1; axe
            // scrollable-region-focusable — a view-only table has nothing focusable).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
            tabIndex={0}
            role="region"
            aria-label={text('caption')}
          >
            <table className={tableClasses.table} data-testid="branches-table">
              <caption className="sr-only">{text('caption')}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  {(
                    ['name', 'code', 'location', 'timezone', 'units', 'people', 'status'] as const
                  ).map((column) => (
                    <th key={column} scope="col" className={tableClasses.head}>
                      {text(`columns.${column}`)}
                    </th>
                  ))}
                  {canManage ? (
                    <th scope="col" className={`${tableClasses.head} text-end`}>
                      {text('columns.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr
                    key={branch.id}
                    className={tableClasses.row}
                    data-testid={`branch-row-${branch.code}`}
                  >
                    <td className={tableClasses.cell}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{branch.name}</span>
                        {branch.isHeadquarters ? (
                          <Badge tone="info">{text('headquarters')}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className={tableClasses.cell}>
                      <span dir="ltr">{branch.code}</span>
                    </td>
                    <td className={tableClasses.cell}>{branch.location ?? '—'}</td>
                    <td className={tableClasses.cell}>{branch.timezoneLabel}</td>
                    <td className={`${tableClasses.cell} tabular-nums`}>{branch.unitCount}</td>
                    <td className={`${tableClasses.cell} tabular-nums`}>{branch.peopleCount}</td>
                    <td className={tableClasses.cell}>
                      <Badge tone={branch.active ? 'success' : 'neutral'}>
                        {branch.active ? text('active') : text('inactive')}
                      </Badge>
                    </td>
                    {canManage ? (
                      <td className={`${tableClasses.cell} text-end`}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                            aria-label={fill('actionsFor', { name: branch.name })}
                            data-testid="branch-menu"
                          >
                            <Icon name="more" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
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
                                setDialog({ kind: 'status', branch });
                              }}
                            >
                              <Icon name={branch.active ? 'lock' : 'check'} />
                              {branch.active ? text('deactivate') : text('activate')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              tone="danger"
                              onSelect={() => {
                                setDialog({ kind: 'delete', branch });
                              }}
                            >
                              <Icon name="trash" />
                              {text('delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.kind === 'form' ? (
        <BranchDialog
          branch={dialog.branch}
          parents={branches
            .filter((b) => b.id !== dialog.branch?.id)
            .map((b) => ({ value: b.id, label: b.name }))}
          countries={props.countries}
          timeZones={props.timeZones}
          defaultTimeZone={props.defaultTimeZone}
          texts={texts}
          errors={props.errors}
          locale={locale}
          onClose={close}
        />
      ) : null}

      {dialog?.kind === 'status' ? (
        <ConfirmDialog
          title={fill(dialog.branch.active ? 'status.deactivateTitle' : 'status.activateTitle', {
            name: dialog.branch.name,
          })}
          description={
            dialog.branch.active ? text('status.deactivateText') : text('status.activateText')
          }
          confirmLabel={dialog.branch.active ? text('status.confirmDeactivate') : text('activate')}
          workingLabel={text('status.working')}
          keepLabel={text('form.cancel')}
          closeLabel={text('form.close')}
          onClose={close}
          data-testid="branch-status-dialog"
          onConfirm={() =>
            run(
              () =>
                setBranchStatusAction({
                  id: dialog.branch.id,
                  version: dialog.branch.version,
                  status: dialog.branch.active ? 'inactive' : 'active',
                }),
              fill(dialog.branch.active ? 'toasts.deactivated' : 'toasts.activated', {
                name: dialog.branch.name,
              }),
            )
          }
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
  const left = [
    { key: 'remove.inUseBranches', count: branch.childCount },
    { key: 'remove.inUseUnits', count: branch.unitCount },
    { key: 'remove.inUsePeople', count: branch.peopleCount },
  ].filter((item) => item.count > 0);
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
