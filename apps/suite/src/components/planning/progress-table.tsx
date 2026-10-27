'use client';
import {
  Badge,
  type BadgeTone,
  ListCard,
  ListCards,
  buttonClasses,
  cn,
  tableClasses,
} from '@jadarat/ui';
import { useState } from 'react';
import { STATUS_FILTERS, type StatusFilter } from '../../lib/planning-view';

export interface ProgressRow {
  readonly id: string;
  readonly name: string;
  /** Who receives the form, as text; null: nobody (a «No head» pill). */
  readonly head: string | null;
  readonly envelope: string;
  readonly status: Exclude<StatusFilter, 'all'>;
  readonly statusLabel: string;
  readonly tone: BadgeTone;
  /** The needs entered so far, as text («3 needs · 12 seats»; WP-LD-01). */
  readonly needs: string;
  /** A line under the status, e.g. «Extended to 5 Dec» (WP-LD-01, Q3); null: none. */
  readonly note: string | null;
  /** The department's needs page («View»); null before the launch. */
  readonly href: string | null;
  readonly viewLabel: string;
}

export interface ProgressTableProps {
  readonly rows: readonly ProgressRow[];
  readonly counts: Readonly<Record<StatusFilter, string>>;
  readonly texts: {
    readonly filterLabel: string;
    readonly caption: string;
    readonly noHead: string;
    readonly envelope: string;
    /** The chips' names: All and every form status. */
    readonly chips: Readonly<Record<StatusFilter, string>>;
    /** The column headers (the unit column is named after the organization's level). */
    readonly columns: Readonly<
      Record<'department' | 'head' | 'envelope' | 'needs' | 'status' | 'actions', string>
    >;
    readonly view: string;
  };
}

const DOT: Readonly<Record<Exclude<StatusFilter, 'all'>, string>> = {
  not_started: 'bg-border-strong',
  draft: 'bg-info',
  submitted: 'bg-success',
  returned: 'bg-warning',
  late: 'bg-danger',
};

/**
 * The cycle's units and their form status (business flow C9; redesign package 4): status chips with their
 * counts filter the table in the browser — the rows are all loaded already (All · Not started · Draft ·
 * Submitted · Returned · Late). A table on wide screens, one card per unit on phones.
 */
export function ProgressTable({ rows, counts, texts }: ProgressTableProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const shown = filter === 'all' ? rows : rows.filter((row) => row.status === filter);
  return (
    <>
      <div
        role="group"
        aria-label={texts.filterLabel}
        className="flex flex-wrap gap-2"
        data-testid="progress-filters"
      >
        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
            }}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] px-3.5 text-[14.5px] font-medium transition-colors pointer-coarse:min-h-11',
              filter === key
                ? 'border-primary bg-primary-subtle text-primary-text'
                : 'border-border-strong bg-surface hover:bg-surface-hover',
              filter !== key && (counts[key] === '0' ? 'text-text-muted' : 'text-text'),
            )}
            data-testid={`progress-filter-${key}`}
          >
            {key === 'all' ? null : (
              <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[key])} />
            )}
            {texts.chips[key]}
            <span className="rounded-full bg-surface-hover px-2 text-[13px] font-semibold tabular-nums text-text-muted">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-2">
        <div className={`${tableClasses.wrapper} hidden md:block`}>
          <table className={tableClasses.table} data-testid="progress-table">
            <caption className="sr-only">{texts.caption}</caption>
            <thead className={tableClasses.header}>
              <tr>
                {(['department', 'head', 'envelope', 'needs', 'status', 'actions'] as const).map(
                  (key) => (
                    <th
                      key={key}
                      scope="col"
                      className={tableClasses.head}
                      data-testid={`progress-column-${key}`}
                    >
                      {texts.columns[key]}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={tableClasses.row} data-testid="progress-row">
                  <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                    {row.name}
                  </th>
                  <td className={tableClasses.cell}>
                    {row.head ?? <Badge tone="warning">{texts.noHead}</Badge>}
                  </td>
                  <td className={`${tableClasses.cell} tabular-nums`}>{row.envelope}</td>
                  <td className={`${tableClasses.cell} tabular-nums`} data-testid="progress-needs">
                    {row.needs}
                  </td>
                  <td className={tableClasses.cell}>
                    <Badge tone={row.tone} dot data-testid="progress-status">
                      {row.statusLabel}
                    </Badge>
                    {row.note ? (
                      <span className="mt-1 block text-[13px] text-text-muted">{row.note}</span>
                    ) : null}
                  </td>
                  <td className={tableClasses.cell}>
                    {row.href ? (
                      <a
                        href={row.href}
                        aria-label={row.viewLabel}
                        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        data-testid="progress-view"
                      >
                        {texts.view}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListCards aria-label={texts.caption}>
          {shown.map((row) => (
            <ListCard
              key={row.id}
              title={row.name}
              detail={
                <>
                  <span className="block">{row.head ?? texts.noHead}</span>
                  <span className="block">
                    {texts.envelope}: {row.envelope}
                  </span>
                  <span className="block">{row.needs}</span>
                </>
              }
              status={
                <Badge tone={row.tone} dot>
                  {row.statusLabel}
                </Badge>
              }
              action={
                row.href ? (
                  <a
                    href={row.href}
                    aria-label={row.viewLabel}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    {texts.view}
                  </a>
                ) : undefined
              }
            />
          ))}
        </ListCards>
      </div>
    </>
  );
}
