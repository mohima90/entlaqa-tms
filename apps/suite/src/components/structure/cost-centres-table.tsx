'use client';
import {
  Alert,
  Badge,
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
  SidePanel,
  TextField,
  cn,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import {
  createCostCentreAction,
  deleteCostCentreAction,
  updateCostCentreAction,
} from '../../actions/cost-centres';
import { fillText } from '../../lib/fill-text';
import { costCentreFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { ConfirmDialog } from './confirm-dialog';
import { type Failure, failureOf } from './failure';

/** A cost centre as the page shows it (name in the page's language and the usage line formatted on the server). */
export interface CostCentreView {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly name: string;
  readonly active: boolean;
  readonly version: number;
  readonly peopleCount: number;
  readonly unitCount: number;
  /** «12 people · 2 units». */
  readonly usageLabel: string;
}

export interface CostCentresTableProps {
  readonly rows: readonly CostCentreView[];
  readonly canManage: boolean;
  /** Texts of the `structure` namespace (raw, flattened) plus `required` / `optional`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
}

type DialogState =
  | { readonly kind: 'form'; readonly row: CostCentreView | null }
  | { readonly kind: 'delete'; readonly row: CostCentreView };

/**
 * Structure → Cost centres (WP-HR-01; FR-ADM-05, FR-FIN-03; business flow EP-ORG-structure-completion.md §3 A;
 * design screen 2, approved by the PO 24 Oct 2026; Mobbin refs Ramp, Brex, Rippling): the finance codes that pay
 * for training — code, names, how many people and units use each one, active / inactive. «Add cost centre» and
 * Edit open a side panel; one in use is deactivated rather than deleted (it stays on the people who have it).
 */
export function CostCentresTable({
  rows,
  canManage,
  texts,
  errors,
  locale,
}: CostCentresTableProps) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => {
    setDialog(null);
  };

  function refusal(error: Parameters<typeof sessionRefused>[0]): string | null {
    if (sessionRefused(error)) return null;
    const failure = failureOf(error, text, errors, costCentreFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  async function setActive(row: CostCentreView, active: boolean) {
    const result = await updateCostCentreAction({
      id: row.id,
      version: row.version,
      code: row.code,
      nameEn: row.nameEn ?? '',
      nameAr: row.nameAr ?? '',
      status: active ? 'active' : 'inactive',
    });
    if (!result.ok) {
      const message = refusal(result.error);
      if (message) toast.error(message);
      return;
    }
    toast.success(
      fill(active ? 'costCentres.activated' : 'costCentres.deactivated', { code: row.code }),
    );
    router.refresh();
  }

  const add = () => {
    setDialog({ kind: 'form', row: null });
  };

  const statusBadge = (row: CostCentreView) =>
    row.active ? (
      <Badge tone="success">{text('costCentres.active')}</Badge>
    ) : (
      <Badge tone="warning">{text('inactive')}</Badge>
    );

  const menu = (row: CostCentreView) => {
    const used = row.peopleCount + row.unitCount > 0;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={fill('actionsFor', { name: row.code })}
          data-testid="cost-centre-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-80">
          <DropdownMenuItem
            onSelect={() => {
              setDialog({ kind: 'form', row });
            }}
            data-testid="cost-centre-edit"
          >
            <Icon name="pencil" />
            {text('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void setActive(row, !row.active);
            }}
            data-testid="cost-centre-status"
          >
            <Icon name={row.active ? 'ban' : 'check'} />
            {row.active ? text('deactivate') : text('activate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone={used ? 'default' : 'danger'}
            aria-disabled={used || undefined}
            className={cn(used && 'items-start text-text-muted')}
            onSelect={() => {
              setDialog({ kind: 'delete', row });
            }}
            data-testid="cost-centre-delete"
          >
            <Icon name="trash" className={cn(used && 'mt-0.5')} />
            <span className="flex flex-col gap-0.5">
              <span>{text('delete')}</span>
              {used ? <span className="text-[13px] text-text-muted">{row.usageLabel}</span> : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      <section
        aria-labelledby="cost-centres-title"
        className="overflow-hidden rounded-xl border border-border bg-surface"
        data-testid="cost-centres"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-5.5 pb-4 pt-5">
          <div className="min-w-0 flex-[1_1_18rem]">
            <h2 id="cost-centres-title" className="m-0 text-lg font-bold">
              {text('costCentres.title')}
            </h2>
            <p className="m-0 text-sm text-text-muted">{text('costCentres.description')}</p>
          </div>
          {canManage && rows.length > 0 ? (
            <Button onClick={add} className="w-full md:w-auto" data-testid="cost-centre-add">
              <Icon name="plus" />
              {text('costCentres.add')}
            </Button>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            headingLevel={3}
            title={text('costCentres.empty')}
            description={
              canManage ? text('costCentres.emptyBody') : text('costCentres.emptyViewOnly')
            }
            action={
              canManage ? (
                <Button onClick={add} data-testid="cost-centre-add">
                  <Icon name="plus" />
                  {text('costCentres.add')}
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div
              className={`${tableClasses.wrapper} hidden focus-visible:outline-2 focus-visible:outline-offset-2 md:block`}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
              tabIndex={0}
              role="region"
              aria-label={text('costCentres.title')}
            >
              <table className={tableClasses.table} data-testid="cost-centres-table">
                <caption className="sr-only">{text('costCentres.title')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    {(['code', 'name', 'people', 'units', 'status'] as const).map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className={cn(
                          tableClasses.head,
                          (column === 'people' || column === 'units') && 'text-end',
                        )}
                      >
                        {text(`costCentres.columns.${column}`)}
                      </th>
                    ))}
                    {canManage ? (
                      <th scope="col" className={tableClasses.head}>
                        <span className="sr-only">{text('costCentres.columns.actions')}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={tableClasses.row}
                      data-testid={`cost-centre-row-${row.code}`}
                    >
                      <td className={tableClasses.cell}>
                        <span dir="ltr" className="font-mono text-sm font-semibold">
                          {row.code}
                        </span>
                      </td>
                      <td className={cn(tableClasses.cell, !row.active && 'text-text-muted')}>
                        {row.name}
                      </td>
                      <td className={`${tableClasses.cell} text-end tabular-nums`}>
                        {row.peopleCount}
                      </td>
                      <td className={`${tableClasses.cell} text-end tabular-nums`}>
                        {row.unitCount}
                      </td>
                      <td className={tableClasses.cell}>{statusBadge(row)}</td>
                      {canManage ? (
                        <td className={`${tableClasses.cell} text-end`}>{menu(row)}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListCards className="border-t border-border" data-testid="cost-centres-cards">
              {rows.map((row) => (
                <ListCard
                  key={row.id}
                  title={row.name}
                  detail={<span dir="ltr">{row.code}</span>}
                  status={
                    <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
                      {statusBadge(row)}
                      <span>{row.usageLabel}</span>
                    </span>
                  }
                  action={canManage ? menu(row) : undefined}
                />
              ))}
            </ListCards>
          </>
        )}
      </section>

      {dialog?.kind === 'form' ? (
        <CostCentrePanel
          row={dialog.row}
          text={text}
          fill={fill}
          errors={errors}
          onClose={close}
          sessionRefused={sessionRefused}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title={fill('costCentres.deleteTitle', { code: dialog.row.code })}
          description={text('costCentres.deleteText')}
          confirmLabel={text('remove.confirm')}
          workingLabel={text('remove.deleting')}
          keepLabel={text('costCentres.keep')}
          closeLabel={text('form.close')}
          danger
          canConfirm={dialog.row.peopleCount + dialog.row.unitCount === 0}
          onClose={close}
          data-testid="cost-centre-delete-dialog"
          onConfirm={async () => {
            const result = await deleteCostCentreAction({
              id: dialog.row.id,
              version: dialog.row.version,
            });
            if (result.ok) {
              toast.success(fill('costCentres.deleted', { code: dialog.row.code }));
              router.refresh();
              return null;
            }
            return refusal(result.error);
          }}
        >
          {dialog.row.peopleCount + dialog.row.unitCount > 0 ? (
            <Alert tone="warning" data-testid="cost-centre-in-use">
              {fill('costCentres.inUseDetail', { usage: dialog.row.usageLabel })}
            </Alert>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

const FORM_ID = 'cost-centre-form';

/** «Add cost centre» / Edit (design screen 2): code, names in both languages, active. */
function CostCentrePanel({
  row,
  text,
  fill,
  errors,
  onClose,
  sessionRefused,
}: {
  readonly row: CostCentreView | null;
  readonly text: (key: string) => string;
  readonly fill: (key: string, values: Record<string, string | number>) => string;
  readonly errors: ErrorTexts;
  readonly onClose: () => void;
  readonly sessionRefused: ReturnType<typeof useSessionRefusal>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
  const [active, setActive] = useState(row?.active ?? true);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const fields = {
      code: field('code'),
      nameEn: field('nameEn'),
      nameAr: field('nameAr'),
      status: active ? ('active' as const) : ('inactive' as const),
    };
    // A name in at least one language (the action repeats it).
    if (fields.nameEn.trim() === '' && fields.nameAr.trim() === '') {
      setFailure({ fields: { nameEn: text('costCentres.name') }, message: null });
      return;
    }
    setFailure({ fields: {}, message: null });
    startTransition(async () => {
      const result = row
        ? await updateCostCentreAction({ ...fields, id: row.id, version: row.version })
        : await createCostCentreAction(fields);
      if (result.ok) {
        toast.success(
          row ? text('toasts.saved') : fill('costCentres.created', { code: fields.code.trim() }),
        );
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setFailure(failureOf(result.error, text, errors, costCentreFieldText));
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={row ? fill('costCentres.editTitle', { code: row.code }) : text('costCentres.addTitle')}
      description={text('costCentres.formDescription')}
      closeLabel={text('form.close')}
      data-testid="cost-centre-dialog"
      footer={
        <>
          <p className="m-0 flex w-full items-center gap-2 text-[13px] text-text-muted">
            <Icon name="shield-outline" />
            {text('form.audited')}
          </p>
          <div className="ms-auto flex gap-2.5">
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {text('form.cancel')}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={pending}
              aria-busy={pending || undefined}
              data-testid="cost-centre-dialog-submit"
            >
              {pending ? text('form.saving') : row ? text('form.save') : text('form.create')}
            </Button>
          </div>
        </>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {/* Names first, the finance code after (fewest-fields form, PO 27 Oct 2026). */}
        <TextField
          id="cost-centre-nameEn"
          name="nameEn"
          label={text('form.nameEn')}
          dir="ltr"
          lang="en"
          maxLength={120}
          autoComplete="off"
          defaultValue={row?.nameEn ?? ''}
          error={failure.fields.nameEn}
          disabled={pending}
        />
        <TextField
          id="cost-centre-nameAr"
          name="nameAr"
          label={text('form.nameAr')}
          hint={text('costCentres.nameHint')}
          dir="rtl"
          lang="ar"
          maxLength={120}
          autoComplete="off"
          defaultValue={row?.nameAr ?? ''}
          error={failure.fields.nameAr}
          disabled={pending}
        />
        <TextField
          id="cost-centre-code"
          name="code"
          label={text('form.code')}
          marker={text('required')}
          hint={text('costCentres.codeHint')}
          required
          dir="ltr"
          maxLength={32}
          autoComplete="off"
          defaultValue={row?.code ?? ''}
          error={failure.fields.code}
          disabled={pending}
        />
        {row ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-4">
            <input
              id="cost-centre-active"
              type="checkbox"
              aria-describedby="cost-centre-active-hint"
              checked={active}
              onChange={(event) => {
                setActive(event.target.checked);
              }}
              disabled={pending}
              className="mt-0.5 size-5 shrink-0 accent-primary"
              data-testid="cost-centre-active"
            />
            <span className="flex flex-col gap-0.5">
              <label htmlFor="cost-centre-active" className="cursor-pointer font-semibold">
                {text('costCentres.active')}
              </label>
              <span id="cost-centre-active-hint" className="text-sm text-text-muted">
                {text('costCentres.activeHint')}
              </span>
            </span>
          </div>
        ) : null}
        {failure.message ? (
          <Alert tone="danger" data-testid="cost-centre-dialog-message">
            {failure.message}
          </Alert>
        ) : null}
      </form>
    </SidePanel>
  );
}
