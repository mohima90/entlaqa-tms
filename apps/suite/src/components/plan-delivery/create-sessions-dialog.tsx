'use client';
import type { DraftProposalView } from '@jadarat/tms';
import { createDraftSessionsAction } from '@jadarat/tms/actions/sessions';
import { Alert, Button, Dialog, Icon, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
import {
  type SessionRowState,
  checkSessions,
  parseSeats,
  rowsFromProposal,
} from '../../lib/plan-delivery-view';
import type { ErrorTexts } from '../auth/error-text';
import { usePlanTexts } from '../training-plan/use-plan-texts';

export interface CreateSessionsDialogProps {
  readonly locale: 'ar' | 'en';
  readonly view: DraftProposalView;
  /** The planning period's months with their names in the organization's date display. */
  readonly months: readonly { readonly value: string; readonly label: string }[];
  /** «The approved plan: 47 people, 3 sessions of 8–20, Q1, SAR 9,000 each.» */
  readonly lead: string;
  readonly quarter: string;
  readonly fractionDigits: number;
  readonly closeHref: string;
  readonly preview: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/** A row's problem: a live check (RowProblem) or a server refusal's key. */
type Problems = Readonly<Record<number, string>>;

/** Server field-error codes of a row (`sessions.<i>.…`) → the row's message key. */
function rowProblemsOf(paths: readonly { path: string; code: string }[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const { path, code } of paths) {
    const match = /^sessions\.(\d+)(?:\.(\w+))?/.exec(path);
    if (!match) continue;
    const index = Number(match[1]);
    out[index] ??=
      match[2] === 'branchId' && code === 'NOT_FOUND'
        ? 'BRANCH_NOT_FOUND'
        : match[2] === 'personIds'
          ? code === 'MORE_THAN_SEATS'
            ? 'FEWER_THAN_PEOPLE'
            : 'PEOPLE_CHANGED'
          : code;
  }
  return out;
}

/**
 * «Create 3 draft sessions for «Advanced Excel»» (WP-LD-04, design screen 3; FR-PLN-09, FR-SCH-01 core; Q1 = A,
 * Q2 = A): the approved plan's sessions of a line as editable rows — Month*, Branch, Seats*, the planned
 * participants by department («Sales 15 · names later») and the estimated cost, with a bin — the check under them
 * («All 47 people have a place», the total) and whether the result matches the approved plan. Nothing is saved
 * until «Create N draft sessions»; all or none. 860 px wide (the rows need it); on a phone each session is a card.
 */
export function CreateSessionsDialog(props: CreateSessionsDialogProps) {
  const { locale, view } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<SessionRowState[]>(() =>
    rowsFromProposal(view.proposal.sessions),
  );
  const [serverProblems, setServerProblems] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [tried, setTried] = useState(false);

  const branchName = useMemo(
    () =>
      new Map(
        view.branches.map((b) => [
          b.id,
          locale === 'ar' ? (b.name.ar ?? b.name.en ?? '') : (b.name.en ?? b.name.ar ?? ''),
        ]),
      ),
    [view.branches, locale],
  );
  const departmentName = useMemo(
    () =>
      new Map(
        view.departments.map((d) => [
          d.departmentId,
          locale === 'ar' ? (d.name.ar ?? d.name.en ?? '') : (d.name.en ?? d.name.ar ?? ''),
        ]),
      ),
    [view.departments, locale],
  );
  const amount = (value: string) => {
    try {
      return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
        style: 'currency',
        currency: view.cycle.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: Math.max(0, Math.min(3, props.fractionDigits)),
      }).format(Number(value));
    } catch {
      return `${value} ${view.cycle.currency}`;
    }
  };

  const existingCost =
    view.existing.count === 0
      ? '0'
      : view.check.cost === null
        ? null
        : // The check's cost holds the proposal and the drafts: the drafts' part is what the proposal leaves.
          subtract(
            view.check.cost,
            view.proposal.sessions.map((s) => s.estimatedCost),
          );
  const existingSeats = view.check.seats - view.proposal.sessions.reduce((n, s) => n + s.seats, 0);
  const check = checkSessions(
    rows,
    {
      people: view.line.people,
      costPerSession: view.line.costPerSession,
      costPerPerson: view.line.costPerPerson,
      cost: view.line.cost,
      quarter: view.line.quarter,
    },
    { seats: existingSeats, cost: existingCost, count: view.existing.count },
    { start: view.cycle.periodStart, end: view.cycle.periodEnd },
  );
  const problems: Problems = { ...(tried ? check.problems : {}), ...serverProblems };

  const go = (href: string) => {
    setOpen(false);
    router.replace(href, { scroll: false });
  };
  const close = () => {
    if (!pending) go(props.closeHref);
  };
  const change = (index: number, patch: Partial<SessionRowState>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setServerProblems((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index)),
    );
  };
  const remove = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setServerProblems({});
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setTried(true);
    if (rows.length === 0) return;
    if (Object.keys(check.problems).length > 0) {
      setMessage({ tone: 'danger', text: t('sessionsDialog.fixRows') });
      return;
    }
    if (props.preview) {
      setMessage({ tone: 'info', text: t('preview') });
      return;
    }
    const sessions = rows.map((row) => ({
      month: row.month,
      branchId: row.branchId === '' ? null : row.branchId,
      seats: parseSeats(row.seats) ?? 0,
      personIds: [...row.personIds],
    }));
    startTransition(async () => {
      const result = await createDraftSessionsAction({ lineId: view.line.id, sessions });
      if (result.ok) {
        toast.success(
          t('sessionsDialog.created', { count: sessions.length, title: view.line.title }),
        );
        go(props.closeHref);
        return;
      }
      if (texts.sessionRefused(result.error)) return;
      const byRow = rowProblemsOf(result.error.fieldErrors ?? []);
      if (Object.keys(byRow).length > 0) {
        setServerProblems(byRow);
        setMessage({ tone: 'danger', text: t('sessionsDialog.fixRows') });
        return;
      }
      setMessage({ tone: 'danger', text: texts.formMessage(result.error) });
    });
  }

  const quarterOf = (index: number) => check.outsideQuarter[index] ?? false;
  const problemText = (code: string) => t(`sessionsDialog.problems.${code}`);
  const laterDepartments = view.departments.filter((d) => d.seats > d.named);
  const canCreate = view.canCreate && view.remaining > 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      canClose={() => !pending}
      size="lg"
      className="sm:max-w-[860px]"
      title={t('sessionsDialog.title', { count: rows.length, title: view.line.title })}
      description={`${props.lead} ${
        view.existing.count > 0
          ? t('sessionsDialog.leadExisting', { count: view.existing.count })
          : t('sessionsDialog.leadSuggest')
      }`}
      closeLabel={t('close')}
      data-testid="create-sessions-dialog"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={close}
            disabled={pending}
            data-testid="create-sessions-cancel"
          >
            {t('sessionsDialog.cancel')}
          </Button>
          {canCreate ? (
            <Button
              type="submit"
              form="create-sessions-form"
              disabled={pending || rows.length === 0}
              busy={pending}
              data-testid="create-sessions-confirm"
            >
              <Icon name="calendar" className="size-4" />
              {pending
                ? t('sessionsDialog.creating')
                : t('sessionsDialog.create', { count: rows.length })}
            </Button>
          ) : null}
        </>
      }
    >
      {!canCreate ? (
        <Alert tone="info" data-testid="create-sessions-problem">
          {view.problem
            ? (props.errors[`errors.${problemKey(view.problem)}`] ?? t('sessionsDialog.none'))
            : t('sessionsDialog.none')}
        </Alert>
      ) : null}
      {view.proposal.branchSeats.length > 1 ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-info/40 bg-info-subtle px-4 py-3 text-[14.5px]"
          data-testid="create-sessions-branches"
        >
          <Icon name="building" className="mt-0.5 size-4 shrink-0" />
          <p className="m-0">
            {t('sessionsDialog.branches', {
              count: view.proposal.branchSeats.length,
              list: view.proposal.branchSeats
                .map((b) =>
                  t('sessionsDialog.branchSeats', {
                    name:
                      b.branchId === null
                        ? t('sessionsDialog.noBranch')
                        : (branchName.get(b.branchId) ?? t('sessionsDialog.noBranch')),
                    seats: b.seats,
                  }),
                )
                .join(t('listSeparator')),
            })}{' '}
            {view.proposal.branchToCheck
              ? t('sessionsDialog.branchesCheck')
              : t('sessionsDialog.branchesPlaced')}
          </p>
        </div>
      ) : null}
      {message ? (
        <Alert tone={message.tone} data-testid="create-sessions-message">
          {message.text}
        </Alert>
      ) : null}

      <form
        id="create-sessions-form"
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col"
        data-testid="create-sessions-form"
      >
        <div className="overflow-hidden rounded-xl border border-border">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[2rem_minmax(10.5rem,1.4fr)_minmax(7rem,1fr)_5rem_minmax(8rem,1.3fr)_6.5rem_2.75rem] gap-3 border-b border-border bg-surface-sunken px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted md:grid"
          >
            <span>#</span>
            <span>
              {t('sessionsDialog.columns.month')}
              <span className="text-danger">*</span>
            </span>
            <span>{t('sessionsDialog.columns.branch')}</span>
            <span>
              {t('sessionsDialog.columns.seats')}
              <span className="text-danger">*</span>
            </span>
            <span>{t('sessionsDialog.columns.people')}</span>
            <span className="text-end">{t('sessionsDialog.columns.cost')}</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <p className="m-0 px-4 py-5 text-text-muted">{t('sessionsDialog.noRows')}</p>
          ) : null}
          {rows.map((row, index) => {
            const number = index + 1;
            const problem = problems[index];
            const cost = check.costs[index] ?? null;
            const errorId = `session-${String(number)}-error`;
            return (
              <fieldset
                key={row.key}
                className="m-0 grid grid-cols-2 items-start gap-3 border-0 border-b border-border px-4 py-3.5 last:border-b-0 md:grid-cols-[2rem_minmax(10.5rem,1.4fr)_minmax(7rem,1fr)_5rem_minmax(8rem,1.3fr)_6.5rem_2.75rem] md:items-center"
                aria-describedby={problem ? errorId : undefined}
                data-testid="create-sessions-row"
              >
                <legend className="sr-only">{t('sessionsDialog.rowLabel', { number })}</legend>
                <span
                  aria-hidden="true"
                  className="col-span-2 grid size-7 place-items-center rounded-full bg-primary text-[13px] font-bold text-on-brand md:col-span-1"
                >
                  {number}
                </span>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-semibold text-text-muted md:sr-only">
                    {t('sessionsDialog.columns.month')}
                    <span aria-hidden="true" className="text-danger">
                      *
                    </span>
                    <span className="sr-only">
                      {' '}
                      {t('sessionsDialog.rowLabel', { number })} {t('required')}
                    </span>
                  </span>
                  <select
                    value={row.month}
                    required
                    onChange={(event) => {
                      change(index, { month: event.target.value });
                    }}
                    disabled={pending}
                    aria-invalid={problem === 'OUTSIDE_PERIOD' ? true : undefined}
                    className="select-chevron min-h-11 w-full rounded-md border-[1.5px] border-border-strong bg-surface ps-3 pe-9 text-[15px] focus:border-primary"
                    data-testid="create-sessions-month"
                  >
                    {props.months.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-semibold text-text-muted md:sr-only">
                    {t('sessionsDialog.columns.branch')}
                    <span className="sr-only"> {t('sessionsDialog.rowLabel', { number })}</span>
                  </span>
                  <select
                    value={row.branchId}
                    onChange={(event) => {
                      change(index, { branchId: event.target.value });
                    }}
                    disabled={pending}
                    className="select-chevron min-h-11 w-full rounded-md border-[1.5px] border-border-strong bg-surface ps-3 pe-9 text-[15px] focus:border-primary"
                    data-testid="create-sessions-branch"
                  >
                    <option value="">
                      {view.line.deliveryType === 'virtual' ||
                      view.line.deliveryType === 'elearning'
                        ? t('sessionsDialog.online')
                        : t('sessionsDialog.noBranch')}
                    </option>
                    {view.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branchName.get(branch.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-semibold text-text-muted md:sr-only">
                    {t('sessionsDialog.columns.seats')}
                    <span aria-hidden="true" className="text-danger">
                      *
                    </span>
                    <span className="sr-only">
                      {' '}
                      {t('sessionsDialog.rowLabel', { number })} {t('required')}
                    </span>
                  </span>
                  <input
                    value={row.seats}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) => {
                      change(index, { seats: event.target.value });
                    }}
                    disabled={pending}
                    aria-invalid={
                      problem === 'SEATS' || problem === 'FEWER_THAN_PEOPLE' ? true : undefined
                    }
                    className={cn(
                      'min-h-11 w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3 text-center text-[15px] tabular-nums focus:border-primary',
                      (problem === 'SEATS' || problem === 'FEWER_THAN_PEOPLE') && 'border-danger',
                    )}
                    data-testid="create-sessions-seats"
                  />
                </label>
                <div className="col-span-2 flex flex-wrap gap-1.5 md:col-span-1">
                  <span className="sr-only">{t('sessionsDialog.columns.people')}: </span>
                  {row.departments.map((d) => (
                    <span
                      key={d.departmentId}
                      className="rounded-md bg-surface-hover px-2 py-0.5 text-[13px]"
                    >
                      {t('sessionsDialog.deptSeats', {
                        name: departmentName.get(d.departmentId) ?? '',
                        seats: d.seats,
                      })}
                      {d.named === 0 ? (
                        <span className="text-text-muted"> · {t('sessionsDialog.namesLater')}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
                <span className="text-sm tabular-nums md:text-end md:text-[15px]">
                  <span className="text-text-muted md:sr-only">
                    {t('sessionsDialog.columns.cost')}:{' '}
                  </span>
                  {cost === null ? '—' : amount(cost)}
                </span>
                <span className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      remove(index);
                    }}
                    disabled={pending}
                    aria-label={t('sessionsDialog.removeRow', { number })}
                    className="grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-danger pointer-coarse:size-11"
                    data-testid="create-sessions-remove"
                  >
                    <Icon name="trash" className="size-4.5" />
                  </button>
                </span>
                {problem || quarterOf(index) ? (
                  <p
                    id={errorId}
                    className={cn(
                      'col-span-2 m-0 flex items-center gap-1.5 text-[13.5px] font-semibold md:col-span-7 md:ps-11',
                      problem ? 'text-danger' : 'text-warning',
                    )}
                  >
                    <Icon name={problem ? 'error' : 'warning'} className="size-4" />
                    {problem ? problemText(problem) : t('sessionsDialog.outside')}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
          <div
            className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-sunken px-4 py-3 font-semibold"
            data-testid="create-sessions-total"
          >
            <span>{t('sessionsDialog.total', { count: rows.length, quarter: props.quarter })}</span>
            <span className="tabular-nums">
              {t('sessionsDialog.seatsTotal', { count: check.seats })}
            </span>
            {check.allPlaced ? (
              <span
                className="inline-flex items-center gap-1.5 text-success"
                data-testid="create-sessions-all-placed"
              >
                <Icon name="success" className="size-4" />
                {t('sessionsDialog.allPlaced', { count: view.line.people })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-warning">
                <Icon name="warning" className="size-4" />
                {t('sessionsDialog.unplaced', { count: check.unplaced })}
              </span>
            )}
            {check.cost !== null ? (
              <span className="tabular-nums md:ms-auto">{amount(check.cost)}</span>
            ) : null}
          </div>
        </div>
      </form>

      <div
        className="flex items-start gap-3 rounded-xl bg-primary-subtle px-4 py-3.5"
        aria-live="polite"
        data-testid="create-sessions-result"
      >
        <Icon name="star" className="mt-0.5 size-4 shrink-0 text-primary-text" />
        <p className="m-0 flex flex-col gap-1 text-[14.5px]">
          <b>
            {check.matchesPlan
              ? t('sessionsDialog.matches', {
                  sessions: t('sessionsDialog.sessionsCount', {
                    count: rows.length + view.existing.count,
                  }),
                  seats: check.totalSeats,
                  amount: check.cost === null ? '' : amount(check.cost),
                })
              : view.line.cost === null || check.cost === null
                ? t('sessionsDialog.noCost', {
                    sessions: t('sessionsDialog.sessionsCount', {
                      count: rows.length + view.existing.count,
                    }),
                    seats: check.totalSeats,
                  })
                : t('sessionsDialog.differs', {
                    sessions: t('sessionsDialog.sessionsCount', {
                      count: rows.length + view.existing.count,
                    }),
                    seats: check.totalSeats,
                    amount: amount(check.cost),
                    plan: amount(view.line.cost),
                  })}
          </b>
          <span>
            {t('sessionsDialog.named', { count: check.named })}
            {laterDepartments.map((d) => (
              <span key={d.departmentId}>
                {' '}
                {t('sessionsDialog.later', {
                  department: departmentName.get(d.departmentId) ?? '',
                  count: d.seats - d.named,
                })}
              </span>
            ))}
          </span>
        </p>
      </div>
      <p className="m-0 flex items-start gap-2 text-sm text-text-muted">
        <Icon name="eye-off" className="mt-0.5 size-4 shrink-0" />
        {t('sessionsDialog.note')}
      </p>
    </Dialog>
  );
}

/** `SESSION_LINE_NEEDS_COURSE` → `sessionLineNeedsCourse` (the message key of a module error code). */
function problemKey(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((part, i) => (i === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join('');
}

/** `total` less the `parts` (exact, thousandths); null when a part is unknown. */
function subtract(total: string, parts: readonly (string | null)[]): string | null {
  if (parts.some((p) => p === null)) return null;
  const milli = (amount: string) => {
    const [whole = '0', fraction = ''] = amount.split('.');
    return BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  };
  const value = parts.reduce((n, p) => n - milli(p ?? '0'), milli(total));
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}
